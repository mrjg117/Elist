/**
 * 最小化 xlsx 读写实现（替代 xlsx-populate）
 * 
 * xlsx 本质是 ZIP 压缩的 XML 文件集合：
 * - [Content_Types].xml
 * - _rels/.rels
 * - xl/workbook.xml
 * - xl/_rels/workbook.xml.rels
 * - xl/worksheets/sheet1.xml, sheet2.xml, sheet3.xml
 * - xl/sharedStrings.xml
 * - xl/styles.xml (可选)
 */

/** 解压 ZIP 文件 */
async function unzip(buffer: ArrayBuffer): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const bytes = new Uint8Array(buffer);
  
  // 查找 ZIP 文件头 (PK\x03\x04)
  let pos = 0;
  while (pos < bytes.length - 4) {
    if (bytes[pos] === 0x50 && bytes[pos + 1] === 0x4B && 
        bytes[pos + 2] === 0x03 && bytes[pos + 3] === 0x04) {
      // 找到本地文件头
      const fileNameLen = bytes[pos + 26] | (bytes[pos + 27] << 8);
      const extraLen = bytes[pos + 28] | (bytes[pos + 29] << 8);
      const compressedSize = bytes[pos + 18] | (bytes[pos + 19] << 8) | 
                            (bytes[pos + 20] << 16) | (bytes[pos + 21] << 24);
      const method = bytes[pos + 8] | (bytes[pos + 9] << 8);
      
      const fileName = new TextDecoder().decode(bytes.slice(pos + 30, pos + 30 + fileNameLen));
      const dataStart = pos + 30 + fileNameLen + extraLen;
      const dataEnd = dataStart + compressedSize;
      
      if (method === 0) {
        // 未压缩
        const content = new TextDecoder().decode(bytes.slice(dataStart, dataEnd));
        files.set(fileName, content);
      } else if (method === 8) {
        // DEFLATE 压缩
        const compressed = bytes.slice(dataStart, dataEnd);
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        const reader = ds.readable.getReader();
        
        writer.write(compressed);
        writer.close();
        
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        
        const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
        const result = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        
        const content = new TextDecoder().decode(result);
        files.set(fileName, content);
      }
      
      pos = dataEnd;
    } else {
      pos++;
    }
  }
  
  return files;
}

/** 压缩文件到 ZIP */
async function zip(files: Map<string, Uint8Array>): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const centralDir: Uint8Array[] = [];
  let offset = 0;
  
  for (const [name, content] of files.entries()) {
    const nameBytes = new TextEncoder().encode(name);
    
    // 压缩内容
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();
    
    writer.write(new Uint8Array(content));
    writer.close();
    
    const compressedChunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      compressedChunks.push(value);
    }
    
    const totalLen = compressedChunks.reduce((sum, c) => sum + c.length, 0);
    const compressed = new Uint8Array(totalLen);
    let compOffset = 0;
    for (const chunk of compressedChunks) {
      compressed.set(chunk, compOffset);
      compOffset += chunk.length;
    }
    
    // 本地文件头
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true); // 签名
    view.setUint16(4, 20, true); // 版本
    view.setUint16(6, 0, true); // 标志
    view.setUint16(8, 8, true); // 压缩方法 (DEFLATE)
    view.setUint16(10, 0, true); // 修改时间
    view.setUint16(12, 0, true); // 修改日期
    view.setUint32(14, 0, true); // CRC32 (简化：设为0)
    view.setUint32(18, compressed.length, true); // 压缩大小
    view.setUint32(22, content.length, true); // 原始大小
    view.setUint16(26, nameBytes.length, true); // 文件名长度
    view.setUint16(28, 0, true); // 额外字段长度
    localHeader.set(nameBytes, 30);
    
    chunks.push(localHeader);
    chunks.push(compressed);
    
    // 中央目录项
    const centralEntry = new Uint8Array(46 + nameBytes.length);
    const cView = new DataView(centralEntry.buffer);
    cView.setUint32(0, 0x02014b50, true); // 签名
    cView.setUint16(4, 20, true); // 创建版本
    cView.setUint16(6, 20, true); // 需要版本
    cView.setUint16(8, 0, true); // 标志
    cView.setUint16(10, 8, true); // 压缩方法
    cView.setUint16(12, 0, true); // 修改时间
    cView.setUint16(14, 0, true); // 修改日期
    cView.setUint32(16, 0, true); // CRC32
    cView.setUint32(20, compressed.length, true); // 压缩大小
    cView.setUint32(24, content.length, true); // 原始大小
    cView.setUint16(28, nameBytes.length, true); // 文件名长度
    cView.setUint16(30, 0, true); // 额外字段长度
    cView.setUint16(32, 0, true); // 注释长度
    cView.setUint16(34, 0, true); // 磁盘号
    cView.setUint16(36, 0, true); // 内部属性
    cView.setUint32(38, 0, true); // 外部属性
    cView.setUint32(42, offset, true); // 本地头偏移
    centralEntry.set(nameBytes, 46);
    
    centralDir.push(centralEntry);
    offset += localHeader.length + compressed.length;
  }
  
  // 中央目录
  const centralStart = offset;
  let centralSize = 0;
  for (const entry of centralDir) {
    chunks.push(entry);
    centralSize += entry.length;
  }
  
  // 中央目录结束
  const endRecord = new Uint8Array(22);
  const eView = new DataView(endRecord.buffer);
  eView.setUint32(0, 0x06054b50, true); // 签名
  eView.setUint16(4, 0, true); // 磁盘号
  eView.setUint16(6, 0, true); // 中央目录起始磁盘
  eView.setUint16(8, centralDir.length, true); // 本磁盘记录数
  eView.setUint16(10, centralDir.length, true); // 总记录数
  eView.setUint32(12, centralSize, true); // 中央目录大小
  eView.setUint32(16, centralStart, true); // 中央目录偏移
  eView.setUint16(20, 0, true); // 注释长度
  chunks.push(endRecord);
  
  // 合并所有块
  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLen);
  let resultOffset = 0;
  for (const chunk of chunks) {
    result.set(chunk, resultOffset);
    resultOffset += chunk.length;
  }
  
  return result.buffer;
}

/** 解析 XML 提取文本内容 */
function parseXml(xml: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(xml, 'text/xml');
}

/** 从 worksheet XML 提取单元格值 */
function extractCells(sheetXml: string, sharedStrings: string[]): string[][] {
  const doc = parseXml(sheetXml);
  const rows: string[][] = [];
  
  const rowElements = Array.from(doc.getElementsByTagName('row'));
  for (const row of rowElements) {
    const cells: string[] = [];
    const cellElements = Array.from(row.getElementsByTagName('c'));
    
    for (const cell of cellElements) {
      const ref = cell.getAttribute('r') || '';
      const colLetter = ref.replace(/[0-9]/g, '');
      const colIndex = colLetterToIndex(colLetter);
      
      const type = cell.getAttribute('t');
      const valueEl = cell.getElementsByTagName('v')[0];
      const value = valueEl?.textContent || '';
      
      // 确保数组足够长
      while (cells.length <= colIndex) {
        cells.push('');
      }
      
      if (type === 's') {
        // 共享字符串
        const idx = parseInt(value);
        cells[colIndex] = sharedStrings[idx] || '';
      } else {
        cells[colIndex] = value;
      }
    }
    
    rows.push(cells);
  }
  
  return rows;
}

/** 列字母转索引 (A=0, B=1, ..., Z=25, AA=26, ...) */
function colLetterToIndex(letters: string): number {
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** 索引转列字母 */
function indexToColLetter(index: number): string {
  let result = '';
  index++;
  while (index > 0) {
    const rem = (index - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    index = Math.floor((index - 1) / 26);
  }
  return result;
}

/** 解析 xlsx 文件 */
export async function parseXlsx(buffer: ArrayBuffer): Promise<Map<string, string[][]>> {
  const files = await unzip(buffer);
  
  // 解析共享字符串
  const sharedStrings: string[] = [];
  const ssXml = files.get('xl/sharedStrings.xml');
  if (ssXml) {
    const doc = parseXml(ssXml);
    const siElements = Array.from(doc.getElementsByTagName('si'));
    for (const si of siElements) {
      const tEl = si.getElementsByTagName('t')[0];
      sharedStrings.push(tEl?.textContent || '');
    }
  }
  
  // 解析工作簿获取 sheet 名称
  const sheets = new Map<string, string[][]>();
  const wbXml = files.get('xl/workbook.xml');
  if (wbXml) {
    const doc = parseXml(wbXml);
    const sheetElements = doc.getElementsByTagName('sheet');
    
    for (let i = 0; i < sheetElements.length; i++) {
      const sheet = sheetElements[i];
      const name = sheet.getAttribute('name') || `Sheet${i + 1}`;
      const sheetFile = `xl/worksheets/sheet${i + 1}.xml`;
      const sheetXml = files.get(sheetFile);
      
      if (sheetXml) {
        const rows = extractCells(sheetXml, sharedStrings);
        sheets.set(name, rows);
      }
    }
  }
  
  return sheets;
}

/** 生成 xlsx 文件 */
export async function generateXlsx(sheets: Map<string, string[][]>): Promise<ArrayBuffer> {
  const files = new Map<string, Uint8Array>();
  
  // 收集所有字符串
  const allStrings: string[] = [];
  const stringIndex = new Map<string, number>();
  
  for (const rows of sheets.values()) {
    for (const row of rows) {
      for (const cell of row) {
        if (cell && !stringIndex.has(cell)) {
          stringIndex.set(cell, allStrings.length);
          allStrings.push(cell);
        }
      }
    }
  }
  
  // [Content_Types].xml
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;
  files.set('[Content_Types].xml', new TextEncoder().encode(contentTypes));
  
  // _rels/.rels
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  files.set('_rels/.rels', new TextEncoder().encode(rels));
  
  // xl/_rels/workbook.xml.rels
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;
  files.set('xl/_rels/workbook.xml.rels', new TextEncoder().encode(wbRels));
  
  // xl/workbook.xml
  const sheetNames = Array.from(sheets.keys());
  const wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheetNames.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('\n    ')}
  </sheets>
</workbook>`;
  files.set('xl/workbook.xml', new TextEncoder().encode(wbXml));
  
  // xl/sharedStrings.xml
  const ssXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${allStrings.length}" uniqueCount="${allStrings.length}">
  ${allStrings.map(s => `<si><t>${escapeXml(s)}</t></si>`).join('\n  ')}
</sst>`;
  files.set('xl/sharedStrings.xml', new TextEncoder().encode(ssXml));
  
  // xl/worksheets/sheetN.xml
  let sheetIdx = 1;
  for (const rows of sheets.values()) {
    const sheetXml = generateSheetXml(rows, stringIndex);
    files.set(`xl/worksheets/sheet${sheetIdx}.xml`, new TextEncoder().encode(sheetXml));
    sheetIdx++;
  }
  
  return await zip(files);
}

/** 生成 worksheet XML */
function generateSheetXml(rows: string[][], stringIndex: Map<string, number>): string {
  const sheetData: string[] = [];
  
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const cells: string[] = [];
    
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const value = row[colIdx];
      if (!value) continue;
      
      const ref = `${indexToColLetter(colIdx)}${rowIdx + 1}`;
      const strIdx = stringIndex.get(value);
      
      if (strIdx !== undefined) {
        cells.push(`<c r="${ref}" t="s"><v>${strIdx}</v></c>`);
      }
    }
    
    if (cells.length > 0) {
      sheetData.push(`<row r="${rowIdx + 1}">${cells.join('')}</row>`);
    }
  }
  
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${sheetData.join('\n    ')}
  </sheetData>
</worksheet>`;
}

/** XML 转义 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
