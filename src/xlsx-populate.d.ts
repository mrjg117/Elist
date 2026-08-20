declare module 'xlsx-populate' {
  export interface Workbook {
    sheet(name: string): Sheet | null;
    addSheet(name: string): Sheet;
    outputAsync(): Promise<ArrayBuffer>;
  }

  export interface Sheet {
    name(): string;
    name(name: string): Sheet;
    cell(ref: string): Cell;
  }

  export interface Cell {
    value(): any;
    value(val: any): Cell;
  }

  const XlsxPopulate: {
    fromBlankAsync(): Promise<Workbook>;
    fromDataAsync(data: ArrayBuffer | Uint8Array): Promise<Workbook>;
  };

  export default XlsxPopulate;
}
