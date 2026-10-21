//! 提醒动作（R-07）：Windows 端用托盘「提醒」子菜单承载与 Android 通知动作等价的操作。
//!
//! 边界：
//! - 只维护托盘菜单与「动作 → 前端事件」的转发，不直接读写数据库；
//!   `events.done` 的写回、贪睡队列与勿扰窗口都在 Web 层 `useReminders.ts`；
//! - 动作集合与 TS `reminder-actions.ts`、Android `ReminderActionTable.kt` 一致：
//!   课前提醒只有贪睡/勿扰，日程提醒多一个「完成」；
//! - 前端收到事件并处理完后调用 `clear_pending_reminder(id)`，托盘菜单随即重建。

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

/// 托盘 id：与 `lib.rs` 的 `TrayIconBuilder::with_id("main-tray")` 一致。
const TRAY_ID: &str = "main-tray";
/// 前端监听的 Tauri 事件名。
pub const REMINDER_EVENT: &str = "reminder-action";
const ITEM_PREFIX: &str = "reminder:";
const MAX_TRAY_ITEMS: usize = 5;
const MAX_TITLE_CHARS: usize = 32;

/// 托盘「提醒」子菜单里的一条待提醒。字段与前端 `set_pending_reminders` 参数一致。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct PendingReminder {
    pub id: String,
    pub title: String,
    #[serde(default = "default_kind")]
    pub kind: String,
}

fn default_kind() -> String {
    "class".to_string()
}

/// 托盘里的待提醒；`set_pending_reminders` 整体替换，前端不再需要时调用 clear。
static PENDING: Mutex<Vec<PendingReminder>> = Mutex::new(Vec::new());

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReminderAction {
    Snooze,
    Done,
    Mute,
}

impl ReminderAction {
    fn id(self) -> &'static str {
        match self {
            ReminderAction::Snooze => "snooze",
            ReminderAction::Done => "done",
            ReminderAction::Mute => "mute",
        }
    }

    fn label(self) -> &'static str {
        match self {
            ReminderAction::Snooze => "贪睡 10 分钟",
            ReminderAction::Done => "完成",
            ReminderAction::Mute => "勿扰 1 小时",
        }
    }

    fn from_id(value: &str) -> Option<Self> {
        match value {
            "snooze" => Some(ReminderAction::Snooze),
            "done" => Some(ReminderAction::Done),
            "mute" => Some(ReminderAction::Mute),
            _ => None,
        }
    }
}

const CLASS_ACTIONS: &[ReminderAction] = &[ReminderAction::Snooze, ReminderAction::Mute];
const EVENT_ACTIONS: &[ReminderAction] = &[
    ReminderAction::Snooze,
    ReminderAction::Done,
    ReminderAction::Mute,
];

/// 某类提醒的动作集合；未知类别按日程处理（与 Android 动作表同一口径）。
fn actions_for_kind(kind: &str) -> &'static [ReminderAction] {
    if kind == "class" {
        CLASS_ACTIONS
    } else {
        EVENT_ACTIONS
    }
}

fn menu_id(index: usize, action: ReminderAction) -> String {
    format!("{ITEM_PREFIX}{index}:{}", action.id())
}

fn parse_menu_id(id: &str) -> Option<(usize, ReminderAction)> {
    let rest = id.strip_prefix(ITEM_PREFIX)?;
    let (index, action) = rest.split_once(':')?;
    Some((index.parse().ok()?, ReminderAction::from_id(action)?))
}

/// 菜单标题过长会撑坏托盘；按字符截断而不是按字节。
fn tray_title(title: &str) -> String {
    let trimmed = title.trim();
    if trimmed.chars().count() <= MAX_TITLE_CHARS {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(MAX_TITLE_CHARS).collect();
    out.push('…');
    out
}

/// 重建并返回托盘菜单（基础项 + 提醒子菜单）。
pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let show_main = MenuItem::with_id(app, "show_main", "显示主窗口", true, None::<&str>)?;
    let show_mini = MenuItem::with_id(app, "show_mini", "显示悬浮窗", true, None::<&str>)?;
    let hide_mini = MenuItem::with_id(app, "hide_mini", "隐藏悬浮窗", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let mut reminders = SubmenuBuilder::with_id(app, "reminders", "提醒");
    let items = pending_snapshot();
    if items.is_empty() {
        reminders = reminders.text("reminder:none", "暂无待提醒");
    } else {
        for (index, item) in items.iter().take(MAX_TRAY_ITEMS).enumerate() {
            let mut group = SubmenuBuilder::with_id(
                app,
                format!("{ITEM_PREFIX}group:{index}"),
                tray_title(&item.title),
            );
            for action in actions_for_kind(&item.kind) {
                group = group.text(menu_id(index, *action), action.label());
            }
            let built = group.build()?;
            reminders = reminders.item(&built);
        }
    }
    let reminder_menu = reminders.build()?;

    let menu = Menu::new(app)?;
    menu.append(&show_main)?;
    menu.append(&show_mini)?;
    menu.append(&hide_mini)?;
    menu.append(&reminder_menu)?;
    menu.append(&quit)?;
    Ok(menu)
}

fn pending_snapshot() -> Vec<PendingReminder> {
    PENDING.lock().map(|items| items.clone()).unwrap_or_default()
}

/// 去重并丢掉空 id：同一个提醒以最后一次下发为准。
fn normalize_pending(items: Vec<PendingReminder>) -> Vec<PendingReminder> {
    let mut out: Vec<PendingReminder> = Vec::new();
    for item in items {
        if item.id.trim().is_empty() {
            continue;
        }
        match out.iter_mut().find(|existing| existing.id == item.id) {
            Some(existing) => *existing = item,
            None => out.push(item),
        }
    }
    out
}

fn refresh_tray(app: &AppHandle) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        // 托盘没建起来（或测试环境）：待提醒仍留在内存里，下次 set 再刷新
        return Ok(());
    };
    let menu = build_menu(app).map_err(|error| format!("重建托盘菜单失败: {error}"))?;
    tray.set_menu(Some(menu))
        .map_err(|error| format!("更新托盘菜单失败: {error}"))
}

/// 前端更新「提醒」子菜单；每次整体替换，最多显示 5 条。
#[tauri::command]
pub fn set_pending_reminders(app: AppHandle, items: Vec<PendingReminder>) -> Result<(), String> {
    *PENDING.lock().map_err(|_| "提醒列表锁已损坏".to_string())? = normalize_pending(items);
    refresh_tray(&app)
}

/// 前端处理完一条动作后清掉它；菜单重建后该项消失。
#[tauri::command]
pub fn clear_pending_reminder(app: AppHandle, id: String) -> Result<(), String> {
    if let Ok(mut items) = PENDING.lock() {
        items.retain(|item| item.id != id);
    }
    refresh_tray(&app)
}

/// 托盘菜单事件：命中提醒动作时 emit 给前端并返回 true，其余交给 `lib.rs` 的原有分支。
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) -> bool {
    let Some((index, action)) = parse_menu_id(id) else {
        return false;
    };
    let Some(item) = pending_snapshot().get(index).cloned() else {
        return true;
    };
    let payload = ReminderActionPayload {
        id: item.id,
        action: action.id().to_string(),
    };
    if let Err(error) = app.emit(REMINDER_EVENT, payload) {
        crate::append_log(&format!("[reminder] 托盘动作发送失败: {error}"));
    }
    true
}

#[derive(Clone, Debug, Serialize)]
struct ReminderActionPayload {
    id: String,
    action: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn class_actions_have_no_done() {
        let labels: Vec<&str> = actions_for_kind("class").iter().map(|action| action.label()).collect();
        assert_eq!(labels, vec!["贪睡 10 分钟", "勿扰 1 小时"]);
        assert!(!actions_for_kind("class").contains(&ReminderAction::Done));
    }

    #[test]
    fn event_actions_include_done() {
        for kind in ["todo", "homework", "exam", "lab", "temp", "unknown"] {
            let labels: Vec<&str> = actions_for_kind(kind).iter().map(|action| action.label()).collect();
            assert_eq!(labels, vec!["贪睡 10 分钟", "完成", "勿扰 1 小时"], "{kind}");
        }
    }

    #[test]
    fn menu_ids_round_trip() {
        for action in EVENT_ACTIONS {
            let id = menu_id(3, *action);
            assert_eq!(parse_menu_id(&id), Some((3, *action)));
        }
        assert_eq!(parse_menu_id("reminder:group:3"), None);
        assert_eq!(parse_menu_id("show_main"), None);
        assert_eq!(parse_menu_id("reminder:x:snooze"), None);
        assert_eq!(parse_menu_id("reminder:1:dismiss"), None);
    }

    #[test]
    fn pending_list_dedupes_by_last_value() {
        let items = normalize_pending(vec![
            PendingReminder { id: "a".into(), title: "高数".into(), kind: "class".into() },
            PendingReminder { id: "a".into(), title: "高数（更新）".into(), kind: "class".into() },
            PendingReminder { id: " ".into(), title: "空 id".into(), kind: "todo".into() },
            PendingReminder { id: "b".into(), title: "作业".into(), kind: "homework".into() },
        ]);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "高数（更新）");
        assert_eq!(items[1].kind, "homework");
    }

    #[test]
    fn long_titles_are_truncated_by_chars() {
        let title = "很".repeat(MAX_TITLE_CHARS + 5);
        let short = tray_title(&title);
        assert_eq!(short.chars().count(), MAX_TITLE_CHARS + 1);
        assert!(short.ends_with('…'));
        assert_eq!(tray_title("  高数  "), "高数");
    }
}
