/**
 * E5 续期 API 动作库。
 *
 * 重构自 e5rnl/worker.js，复用 Elist 的 OneDriveDriver 鉴权。
 * 每个 action 接收一个 Graph API 调用函数，返回动作描述或 null（跳过）。
 */

const MARK = 'mskeep';

type GraphCall = (method: string, path: string, body?: any, absolute?: boolean) => Promise<any>;

// ===================================================================
// 可写工作负载（create + update + read + delete 四步必全；delete 必执行，本轮清理零残留）
// ===================================================================

export async function actionOnedrive(graph: GraphCall) {
  const name = `${MARK}_${crypto.randomUUID()}.txt`;
  const base = `/drive/root:/${MARK}/${name}`;
  const content = `E5 renewal heartbeat @ ${new Date().toISOString()}`;
  try {
    await graph('PUT', `${base}:/content`, content, false);
  } catch (e: any) {
    if (!/-> 404:/.test(e.message)) throw e;
    try {
      await graph('POST', '/drive/root/children', { name: MARK, folder: {} });
    } catch (folderErr: any) {
      throw new Error(`PUT 404 且创建 MARK 文件夹也失败: ${folderErr.message}`);
    }
    await graph('PUT', `${base}:/content`, content, false);
  }
  await graph('PUT', `${base}:/content`, content + ' (updated)', false);
  await graph('GET', `${base}:/content`);
  await graph('DELETE', base);
  return `OneDrive 文件 ${name} 建/改/读/删`;
}

export async function actionOnedriveFolder(graph: GraphCall) {
  const name = `${MARK}_${crypto.randomUUID()}`;
  let created;
  try {
    created = await graph('POST', `/drive/root:/${MARK}:/children`, { name, folder: {} });
  } catch (e: any) {
    if (!/-> 404:/.test(e.message)) throw e;
    try {
      await graph('POST', '/drive/root/children', { name: MARK, folder: {} });
      created = await graph('POST', `/drive/root:/${MARK}:/children`, { name, folder: {} });
    } catch (retryErr: any) {
      throw new Error(`创建文件夹失败（含重试）：${retryErr.message}`);
    }
  }
  await graph('GET', `/drive/items/${created.id}`);
  await graph('DELETE', `/drive/items/${created.id}`);
  return `OneDrive 文件夹 ${name} 建/读/删`;
}

export async function actionOutlook(graph: GraphCall) {
  const created = await graph('POST', '/mailFolders/drafts/messages', {
    subject: `${MARK} heartbeat`,
    body: { contentType: 'text', content: 'automated' },
  });
  const id = created.id;
  await graph('PATCH', `/messages/${id}`, { subject: `${MARK} heartbeat (edited)` });
  await graph('GET', '/mailFolders/drafts/messages');
  await graph('DELETE', `/messages/${id}`);
  return `Outlook 草稿 ${id} 建/改/读/删`;
}

export async function actionCalendar(graph: GraphCall) {
  const start = new Date(Date.now() + 3600 * 1000).toISOString();
  const end = new Date(Date.now() + 7200 * 1000).toISOString();
  const created = await graph('POST', '/calendar/events', {
    subject: `${MARK} heartbeat`,
    start: { dateTime: start, timeZone: 'UTC' },
    end: { dateTime: end, timeZone: 'UTC' },
  });
  const id = created.id;
  const ns = new Date(Date.now() + 5400 * 1000).toISOString();
  await graph('PATCH', `/events/${id}`, { start: { dateTime: ns, timeZone: 'UTC' } });
  await graph('GET', `/events/${id}`);
  await graph('DELETE', `/events/${id}`);
  return `日历事件 ${id} 建/改/读/删`;
}

export async function actionCalendarCal(graph: GraphCall) {
  const cal = await graph('POST', '/calendars', { name: `${MARK}_${crypto.randomUUID()}` });
  await graph('GET', `/calendars/${cal.id}`);
  await graph('DELETE', `/calendars/${cal.id}`);
  return `日历 ${cal.id} 建/读/删`;
}

export async function actionContacts(graph: GraphCall) {
  const created = await graph('POST', '/contacts', {
    givenName: MARK,
    surname: `Renew${Math.floor(Math.random() * 1000)}`,
    emailAddresses: [{ address: 'noreply@example.com' }],
  });
  const id = created.id;
  await graph('PATCH', `/contacts/${id}`, { jobTitle: 'heartbeat' });
  await graph('GET', '/contacts');
  await graph('DELETE', `/contacts/${id}`);
  return `联系人 ${id} 建/改/读/删`;
}

export async function actionTodo(graph: GraphCall) {
  const lists = await graph('GET', '/todo/lists');
  const list = lists && lists.value && lists.value[0];
  if (!list) return null;
  const created = await graph('POST', `/todo/lists/${list.id}/tasks`, {
    title: `${MARK} ${new Date().toISOString()}`,
  });
  const id = created.id;
  await graph('PATCH', `/todo/lists/${list.id}/tasks/${id}`, { status: 'completed' });
  await graph('GET', `/todo/lists/${list.id}/tasks`);
  await graph('DELETE', `/todo/lists/${list.id}/tasks/${id}`);
  return `To Do 任务 ${id} 建/改/读/删`;
}

export async function actionTodoList(graph: GraphCall) {
  const list = await graph('POST', '/todo/lists', {
    displayName: `${MARK}_${crypto.randomUUID()}`,
  });
  await graph('GET', `/todo/lists/${list.id}/tasks`);
  await graph('DELETE', `/todo/lists/${list.id}`);
  return `To Do 清单 ${list.id} 建/读/删`;
}

export async function actionSharepoint(graph: GraphCall) {
  const siteBase = '/sites/root/lists/contacts';
  const created = await graph('POST', `${siteBase}/items`, {
    fields: { Title: `${MARK}_${crypto.randomUUID()}` },
  }, true);
  const id = created.id;
  await graph('PATCH', `${siteBase}/items/${id}/fields`, { Title: `${MARK}_updated` }, true);
  await graph('GET', `${siteBase}/items`, undefined, true);
  await graph('DELETE', `${siteBase}/items/${id}`, undefined, true);
  return `SharePoint 列表项 ${id} 建/改/读/删`;
}

// ===================================================================
// 只读探测（零清理，增加跨工作负载使用足迹）
// ===================================================================

export async function probeTeams(graph: GraphCall) {
  await graph('GET', '/joinedTeams');
  return '已加入 Teams (只读)';
}

export async function probeTeamsChannels(graph: GraphCall) {
  const teams = await graph('GET', '/joinedTeams');
  const t = teams && teams.value && teams.value[0];
  if (t) await graph('GET', `/teams/${t.id}/channels?$top=5`);
  return 'Teams 频道 (只读)';
}

export async function probeMailbox(graph: GraphCall) {
  await graph('GET', '/mailboxSettings');
  return '邮箱设置 (只读)';
}

export async function probeDriveRoot(graph: GraphCall) {
  await graph('GET', '/drive/root/children?$top=1');
  return 'OneDrive 根目录 (只读)';
}

export async function probeDriveList(graph: GraphCall) {
  await graph('GET', '/drive');
  return 'OneDrive 驱动器 (只读)';
}

export async function probeDriveRootDir(graph: GraphCall) {
  await graph('GET', '/drive/root');
  return 'OneDrive 根目录 (只读)';
}

export async function probeMailFolders(graph: GraphCall) {
  await graph('GET', '/mailFolders');
  return '邮件文件夹 (只读)';
}

export async function probeMailInbox(graph: GraphCall) {
  await graph('GET', '/mailFolders/inbox/messages?$top=1');
  return '收件箱邮件 (只读)';
}

export async function probeMessages(graph: GraphCall) {
  await graph('GET', '/messages?$top=1');
  return '邮件列表 (只读)';
}

export async function probeMailCategories(graph: GraphCall) {
  await graph('GET', '/outlook/masterCategories');
  return '邮件分类 (只读)';
}

export async function probeCalendarView(graph: GraphCall) {
  const now = new Date();
  const start = now.toISOString();
  const end = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString();
  await graph('GET', `/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$top=5`);
  return '日历视图 (只读)';
}

export async function probeCalendars(graph: GraphCall) {
  await graph('GET', '/calendars');
  return '日历列表 (只读)';
}

export async function probeEvents(graph: GraphCall) {
  await graph('GET', '/events?$top=1');
  return '日历事件列表 (只读)';
}

export async function probeProfile(graph: GraphCall) {
  await graph('GET', '');
  return '用户档案 (只读)';
}

export async function probeManager(graph: GraphCall) {
  await graph('GET', '/manager');
  return '经理 (只读)';
}

export async function probeDirectReports(graph: GraphCall) {
  await graph('GET', '/directReports');
  return '下属 (只读)';
}

export async function probeMemberOf(graph: GraphCall) {
  await graph('GET', '/memberOf');
  return '所属组 (只读)';
}

export async function probePeople(graph: GraphCall) {
  await graph('GET', '/people');
  return 'People (只读)';
}

export async function probeGroupsAll(graph: GraphCall) {
  await graph('GET', '/groups?$top=5', undefined, true);
  return '全部组 (只读)';
}

export async function probeSharepointSites(graph: GraphCall) {
  await graph('GET', '/sites/root', undefined, true);
  return 'SharePoint 站点 (只读)';
}

export async function probeSharepointSiteLists(graph: GraphCall) {
  await graph('GET', '/sites/root/lists', undefined, true);
  return 'SharePoint 站点列表 (只读)';
}

export async function probeContactsFolders(graph: GraphCall) {
  await graph('GET', '/contactFolders');
  return '联系人文件夹 (只读)';
}

export async function probeTodoListsRead(graph: GraphCall) {
  await graph('GET', '/todo/lists');
  return 'To Do 清单列表 (只读)';
}

// ===================================================================
// 动作池
// ===================================================================

export interface ActionDef {
  name: string;
  fn: (graph: GraphCall) => Promise<string | null>;
  readonly: boolean;
  allow404?: boolean;
}

export const WRITABLE: ActionDef[] = [
  { name: 'onedrive', fn: actionOnedrive, readonly: false },
  { name: 'onedrive_folder', fn: actionOnedriveFolder, readonly: false },
  { name: 'outlook', fn: actionOutlook, readonly: false },
  { name: 'calendar_event', fn: actionCalendar, readonly: false },
  { name: 'calendar_calendar', fn: actionCalendarCal, readonly: false },
  { name: 'contacts', fn: actionContacts, readonly: false },
  { name: 'todo_task', fn: actionTodo, readonly: false },
  { name: 'todo_list', fn: actionTodoList, readonly: false },
  { name: 'sharepoint', fn: actionSharepoint, readonly: false },
];

export const READONLY: ActionDef[] = [
  { name: 'teams', fn: probeTeams, readonly: true },
  { name: 'teams_channels', fn: probeTeamsChannels, readonly: true },
  { name: 'mailbox', fn: probeMailbox, readonly: true },
  { name: 'drive_root', fn: probeDriveRoot, readonly: true },
  { name: 'drive_list', fn: probeDriveList, readonly: true },
  { name: 'drive_root_dir', fn: probeDriveRootDir, readonly: true },
  { name: 'mail_folders', fn: probeMailFolders, readonly: true },
  { name: 'mail_inbox', fn: probeMailInbox, readonly: true },
  { name: 'messages', fn: probeMessages, readonly: true },
  { name: 'mail_categories', fn: probeMailCategories, readonly: true },
  { name: 'calendar_view', fn: probeCalendarView, readonly: true },
  { name: 'calendars', fn: probeCalendars, readonly: true },
  { name: 'events', fn: probeEvents, readonly: true },
  { name: 'profile', fn: probeProfile, readonly: true },
  { name: 'manager', fn: probeManager, readonly: true, allow404: true },
  { name: 'direct_reports', fn: probeDirectReports, readonly: true, allow404: true },
  { name: 'memberof', fn: probeMemberOf, readonly: true },
  { name: 'people', fn: probePeople, readonly: true },
  { name: 'groups_all', fn: probeGroupsAll, readonly: true },
  { name: 'sharepoint_sites', fn: probeSharepointSites, readonly: true },
  { name: 'sharepoint_site_lists', fn: probeSharepointSiteLists, readonly: true },
  { name: 'contacts_folders', fn: probeContactsFolders, readonly: true },
  { name: 'todo_lists_read', fn: probeTodoListsRead, readonly: true },
];

export const ALL_ACTIONS = [...WRITABLE, ...READONLY];

/**
 * 每个动作所需的 Microsoft Graph Application 权限（需在 Entra ID 为应用授予并管理员同意）。
 * 测试时若命中 403 InsufficientPrivileges，据此归类提示缺哪个权限，而非笼统报错。
 */
export const REQUIRED_SCOPES: Record<string, string> = {
  onedrive: 'Files.ReadWrite.All',
  onedrive_folder: 'Files.ReadWrite.All',
  outlook: 'Mail.ReadWrite',
  calendar_event: 'Calendars.ReadWrite',
  calendar_calendar: 'Calendars.ReadWrite',
  contacts: 'Contacts.ReadWrite',
  todo_task: 'Tasks.ReadWrite',
  todo_list: 'Tasks.ReadWrite',
  sharepoint: 'Sites.ReadWrite.All',
  teams: 'Team.ReadBasic.All',
  teams_channels: 'Channel.ReadBasic.All',
  mailbox: 'MailboxSettings.Read',
  drive_root: 'Files.Read.All',
  drive_list: 'Files.Read.All',
  drive_root_dir: 'Files.Read.All',
  mail_folders: 'Mail.Read',
  mail_inbox: 'Mail.Read',
  messages: 'Mail.Read',
  mail_categories: 'Mail.Read',
  calendar_view: 'Calendars.Read',
  calendars: 'Calendars.Read',
  events: 'Calendars.Read',
  profile: 'User.Read.All',
  manager: 'User.Read.All',
  direct_reports: 'User.Read.All',
  memberof: 'GroupMember.Read.All',
  people: 'People.Read.All',
  groups_all: 'Group.Read.All',
  sharepoint_sites: 'Sites.Read.All',
  sharepoint_site_lists: 'Sites.Read.All',
  contacts_folders: 'Contacts.Read',
  todo_lists_read: 'Tasks.Read',
};
