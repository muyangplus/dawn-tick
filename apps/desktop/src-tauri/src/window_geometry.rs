//! 主窗口几何：记录、按显示器重映射与恢复。

use super::*;

/// 主窗口几何：与存进 app_meta 的 `window_geometry` JSON 字段一一对应。
/// `width/height/x/y` 是**物理像素**（且宽高是内尺寸），与旧版文件完全一致；
/// `monitor` 是后加的显示器指纹，旧文件没有该字段、反序列化为 `None`，
/// 此时一律按旧的物理像素逻辑恢复（向后兼容，不 panic）。
/// 注意：宽高是窗口**内尺寸**（客户区），与 `set_size` 的语义一致；
/// 若存外尺寸（`outer_size`），恢复时会被再加一圈边框，窗口每次重启都变大。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct WindowGeometry {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) maximized: bool,
    /// 窗口所在显示器的指纹；缺失（旧文件）或非法时为 None → 走物理像素回退路径。
    /// 为 None 时不写该字段，落盘形态与旧版完全一致。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) monitor: Option<MonitorRef>,
}

/// 窗口所在显示器的指纹：名称、保存时的缩放因子，以及窗口逻辑坐标相对
/// 该显示器逻辑原点的偏移（逻辑像素）。
/// 跨不同缩放的显示器搬窗口时，物理坐标会随缩放整体放大/缩小而失真，
/// 只有「同一块显示器 + 逻辑偏移 + 逻辑尺寸」才是可移植的。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct MonitorRef {
    /// `monitor.name()` 的结果；Windows 上可能拿不到名称，此时为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) name: Option<String>,
    /// 保存时该显示器的缩放因子（1.0 / 1.25 / 1.5 / 2.0 …）。
    /// 字段缺失（手改过的旧文件）时为 0.0，重映射会因非法而退回物理逻辑。
    #[serde(default)]
    pub(crate) scale_factor: f64,
    /// 窗口逻辑坐标相对显示器逻辑原点的偏移（逻辑像素）= (窗口物理坐标 - 显示器物理原点) / scale。
    #[serde(default)]
    pub(crate) offset_x: f64,
    #[serde(default)]
    pub(crate) offset_y: f64,
}

/// 当前显示器快照：物理原点按**当前** scale 换算成逻辑原点，
/// 这样「显示器逻辑原点 + 保存的逻辑偏移」就直接是窗口的目标逻辑坐标。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct MonitorSnapshot {
    pub(crate) name: Option<String>,
    pub(crate) logical_x: f64,
    pub(crate) logical_y: f64,
    pub(crate) scale_factor: f64,
}

/// 重映射结果：窗口在目标显示器上的逻辑坐标与逻辑尺寸（逻辑像素）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct LogicalTarget {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) scale_factor: f64,
}

/// 显示器可见矩形（物理像素）。抽成纯数据类型，便于对可见性判定做单元测试。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ScreenRect {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

/// 尺寸下限：小于该值基本是最小化过程中的脏数据。
pub(crate) const MIN_WINDOW_SIZE: u32 = 400;
/// 尺寸上限：防止显示器热插拔等异常写出离谱尺寸。
pub(crate) const MAX_WINDOW_SIZE: u32 = 10000;
/// 坐标绝对值上限：Windows 虚拟桌面坐标不会超出该范围。
pub(crate) const MAX_WINDOW_COORD: u32 = 20000;
/// 位置容错边距（像素）：窗口与显示器的重叠在宽、高上都达到该值才算「可见」。
pub(crate) const VISIBLE_MARGIN: i32 = 40;
/// 移动/缩放落盘防抖窗口：500ms 内只写一次。
pub(crate) const GEOMETRY_DEBOUNCE: std::time::Duration = std::time::Duration::from_millis(500);
/// 缩放因子上限：Windows 单屏缩放最高 500%，留一倍余量，用于挡住脏数据。
pub(crate) const MAX_SCALE_FACTOR: f64 = 10.0;
/// 重映射后逻辑尺寸的合法区间：换算结果超出该区间说明 scale/物理尺寸已损坏，退回物理逻辑。
pub(crate) const MIN_LOGICAL_SIZE: f64 = 100.0;
pub(crate) const MAX_LOGICAL_SIZE: f64 = MAX_WINDOW_SIZE as f64;
/// 逻辑坐标绝对值上限（与物理坐标同口径）。
pub(crate) const MAX_LOGICAL_COORD: f64 = MAX_WINDOW_COORD as f64;

/// 几何是否合理：宽高在 [400, 10000]，坐标绝对值不超过 20000。
pub(crate) fn geometry_is_sane(geometry: &WindowGeometry) -> bool {
    (MIN_WINDOW_SIZE..=MAX_WINDOW_SIZE).contains(&geometry.width)
        && (MIN_WINDOW_SIZE..=MAX_WINDOW_SIZE).contains(&geometry.height)
        // 用 unsigned_abs 而不是 abs：i32::MIN 上 abs 会溢出 panic
        && geometry.x.unsigned_abs() <= MAX_WINDOW_COORD
        && geometry.y.unsigned_abs() <= MAX_WINDOW_COORD
}

/// 保存的位置是否仍落在某台显示器的可见区域内。
/// 判定口径：窗口矩形与某台显示器矩形的重叠，宽和高都要 ≥ `margin` 像素（容错边距）。
/// 拿不到显示器列表时返回 false —— 宁可不设位置改居中，也不要开出一扇看不见的窗口。
pub(crate) fn position_visible(x: i32, y: i32, width: u32, height: u32, screens: &[ScreenRect], margin: i32) -> bool {
    if screens.is_empty() {
        return false;
    }
    let clamp = |value: u32| -> i32 { value.min(i32::MAX as u32) as i32 };
    let left = x;
    let top = y;
    let right = x.saturating_add(clamp(width));
    let bottom = y.saturating_add(clamp(height));
    screens.iter().any(|screen| {
        let screen_right = screen.x.saturating_add(clamp(screen.width));
        let screen_bottom = screen.y.saturating_add(clamp(screen.height));
        let overlap_width = right.min(screen_right) - left.max(screen.x);
        let overlap_height = bottom.min(screen_bottom) - top.max(screen.y);
        overlap_width >= margin && overlap_height >= margin
    })
}

/// 纯函数：按保存的显示器指纹，把窗口几何换算成目标显示器上的逻辑坐标/尺寸。
/// 返回 `None` 表示**不做**重映射（没有指纹、找不到同名显示器、或数值非法），
/// 调用方应退回物理像素逻辑。任何输入都不 panic。
///
/// 换算口径：逻辑尺寸 = 保存的物理尺寸 / 保存时的 scale（即「当时看起来」的大小），
/// 逻辑位置 = 当前显示器逻辑原点 + 保存的逻辑偏移（同一块屏幕上相对位置不变）。
pub(crate) fn remap_to_monitor(geometry: &WindowGeometry, monitors: &[MonitorSnapshot]) -> Option<LogicalTarget> {
    let saved = geometry.monitor.as_ref()?;
    // scale 缺失（旧文件默认 0.0）或非法：无法把物理尺寸换算成逻辑尺寸，退回旧逻辑
    let saved_scale = saved.scale_factor;
    if !saved_scale.is_finite() || saved_scale <= 0.0 || saved_scale > MAX_SCALE_FACTOR {
        return None;
    }
    if !saved.offset_x.is_finite() || !saved.offset_y.is_finite() {
        return None;
    }
    if saved.offset_x.abs() > MAX_LOGICAL_COORD || saved.offset_y.abs() > MAX_LOGICAL_COORD {
        return None;
    }
    // 只有同名显示器才敢套用偏移：换了显示器/单屏切换时偏移量没有可移植性。
    // 名称为空或缺失时也无法匹配（None 绝不与 None 相等）。
    let name = saved.name.as_deref().filter(|name| !name.is_empty())?;
    let target = monitors
        .iter()
        .find(|monitor| monitor.name.as_deref() == Some(name))?;
    if !target.scale_factor.is_finite() || target.scale_factor <= 0.0 {
        return None;
    }

    let width = geometry.width as f64 / saved_scale;
    let height = geometry.height as f64 / saved_scale;
    let x = target.logical_x + saved.offset_x;
    let y = target.logical_y + saved.offset_y;
    // NaN/无穷一律拒绝（NaN 的比较结果恒为 false，必须先判 is_finite）
    if !x.is_finite() || !y.is_finite() || !width.is_finite() || !height.is_finite() {
        return None;
    }
    if x.abs() > MAX_LOGICAL_COORD || y.abs() > MAX_LOGICAL_COORD {
        return None;
    }
    if !(MIN_LOGICAL_SIZE..=MAX_LOGICAL_SIZE).contains(&width)
        || !(MIN_LOGICAL_SIZE..=MAX_LOGICAL_SIZE).contains(&height)
    {
        return None;
    }

    Some(LogicalTarget {
        x,
        y,
        width,
        height,
        scale_factor: target.scale_factor,
    })
}

/// 由 tauri 的显示器对象构造快照。scale 非法（0/负/NaN/超界）时返回 None，
/// 该显示器不参与重映射，调用方自然退回物理像素逻辑。
#[cfg(desktop)]
pub(crate) fn snapshot_of(monitor: &tauri::Monitor) -> Option<MonitorSnapshot> {
    let scale = monitor.scale_factor();
    if !scale.is_finite() || scale <= 0.0 || scale > MAX_SCALE_FACTOR {
        return None;
    }
    let origin = monitor.position();
    Some(MonitorSnapshot {
        name: monitor.name().map(|name| name.to_string()),
        logical_x: origin.x as f64 / scale,
        logical_y: origin.y as f64 / scale,
        scale_factor: scale,
    })
}

/// 窗口几何存在数据库 app_meta 里（不再落 window.json）：启动时在窗口显示前读出来应用。
#[cfg(desktop)]
pub(crate) const WINDOW_GEOMETRY_KEY: &str = "window_geometry";

/// 只读取一个 app_meta 值：短连接，只读打开不会改日志模式。
#[cfg(desktop)]
pub(crate) async fn read_meta_value(key: &str) -> Option<String> {
    use sqlx::{ConnectOptions, Connection, Row};
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(database_file(&data_dir()))
        .read_only(true)
        .busy_timeout(std::time::Duration::from_millis(500));
    let mut connection = options.connect().await.ok()?;
    let row = sqlx::query("SELECT value FROM app_meta WHERE key = ?")
        .bind(key)
        .fetch_optional(&mut connection)
        .await
        .ok()
        .flatten();
    let _ = connection.close().await;
    row.and_then(|row| row.try_get::<String, _>("value").ok())
}

/// 写入一个 app_meta 值：短连接 + busy_timeout，和前端用的是同一个库文件。
#[cfg(desktop)]
pub(crate) async fn write_meta_value(key: &str, value: &str) -> bool {
    use sqlx::{ConnectOptions, Connection};
    // 只写进已经迁移过的库：库不存在、或还没建出 users 表（迁移未跑）时跳过。
    // 否则全新安装时窗口一移动就先建出 app_meta，001 迁移再建同名表会失败。
    let file = database_file(&data_dir());
    if !file.is_file() {
        return false;
    }
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(file)
        .create_if_missing(false)
        .busy_timeout(std::time::Duration::from_millis(1000));
    let Ok(mut connection) = options.connect().await else {
        return false;
    };
    let migrated = sqlx::query_scalar::<_, i64>(
        // 有 users 与 app_meta 说明迁移已建过表（含早期没有 _sqlx_migrations 的旧库）
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'app_meta')",
    )
    .fetch_one(&mut connection)
    .await
    .map(|count| count == 2)
    .unwrap_or(false);
    let written = migrated
        && sqlx::query(
            "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(key)
        .bind(value)
        .execute(&mut connection)
        .await
        .is_ok();
    let _ = connection.close().await;
    written
}

/// 解析并校验几何文本。缺失、损坏或数值不合理都返回 None（用默认值），绝不 panic、不弹窗。
#[cfg(desktop)]
pub(crate) fn parse_window_geometry(text: &str) -> Option<WindowGeometry> {
    let Ok(geometry) = serde_json::from_str::<WindowGeometry>(text) else {
        append_log("窗口几何不可解析，按默认值处理");
        return None;
    };
    if !geometry_is_sane(&geometry) {
        append_log(&format!(
            "窗口几何不合理，按默认值处理: {}x{} @ ({},{})",
            geometry.width, geometry.height, geometry.x, geometry.y
        ));
        return None;
    }
    Some(geometry)
}

/// 读取窗口几何：数据库里没有或不可用时返回 None。
#[cfg(desktop)]
pub(crate) fn read_window_geometry() -> Option<WindowGeometry> {
    let text = tauri::async_runtime::block_on(read_meta_value(WINDOW_GEOMETRY_KEY))?;
    parse_window_geometry(&text)
}

/// 写入数据库并记日志。数值不合理时不写入，保留上一次的有效值。
#[cfg(desktop)]
pub(crate) fn save_window_geometry(geometry: &WindowGeometry) -> bool {
    if !geometry_is_sane(geometry) {
        return false;
    }
    let Ok(text) = serde_json::to_string(geometry) else {
        return false;
    };
    if !tauri::async_runtime::block_on(write_meta_value(WINDOW_GEOMETRY_KEY, &text)) {
        append_log("窗口几何写入失败");
        return false;
    }
    append_log(&format!(
        "窗口几何已保存: {}x{} @ ({},{}) 最大化={}",
        geometry.width, geometry.height, geometry.x, geometry.y, geometry.maximized
    ));
    true
}

/// 待落盘的最新几何：防抖期间的多次事件只保留最后一个值。
#[cfg(desktop)]
pub(crate) static GEOMETRY_PENDING: std::sync::Mutex<Option<WindowGeometry>> = std::sync::Mutex::new(None);
/// 是否已有计时线程在等待落盘，保证每 500ms 最多起一个线程。
#[cfg(desktop)]
pub(crate) static GEOMETRY_TIMER_RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// 最大化前最后一次普通状态的几何：最大化时保存它，避免之后「还原」出铺满屏幕的窗口。
#[cfg(desktop)]
pub(crate) static GEOMETRY_LAST_NORMAL: std::sync::Mutex<Option<WindowGeometry>> = std::sync::Mutex::new(None);

/// 记录窗口所在显示器的指纹：名称、当前 scale，以及窗口相对该显示器逻辑原点的偏移。
/// 拿不到显示器信息时返回 None —— 几何照旧保存，只是不含指纹（恢复时走物理像素逻辑）。
#[cfg(desktop)]
pub(crate) fn capture_monitor_ref(
    window: &tauri::WebviewWindow,
    position: tauri::PhysicalPosition<i32>,
) -> Option<MonitorRef> {
    let monitor = match window.current_monitor() {
        Ok(Some(monitor)) => Some(monitor),
        Ok(None) => None,
        Err(error) => {
            append_log(&format!("获取窗口所在显示器失败: {error}"));
            None
        }
    };
    // 跨屏或窗口刚建立时 current_monitor 可能为空：退回主显示器，总比没有指纹强
    let monitor = match monitor.or_else(|| window.primary_monitor().ok().flatten()) {
        Some(monitor) => monitor,
        None => {
            append_log("拿不到显示器信息，本次窗口几何不含显示器指纹");
            return None;
        }
    };
    let scale = monitor.scale_factor();
    if !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    let origin = monitor.position();
    // 逻辑偏移 = 物理偏移 / 当前 scale；用 saturating_sub 防止极端坐标溢出
    let offset_x = position.x.saturating_sub(origin.x) as f64 / scale;
    let offset_y = position.y.saturating_sub(origin.y) as f64 / scale;
    if !offset_x.is_finite() || !offset_y.is_finite() {
        return None;
    }
    Some(MonitorRef {
        name: monitor.name().map(|name| name.to_string()),
        scale_factor: scale,
        offset_x,
        offset_y,
    })
}

/// 取当前窗口几何。最小化期间尺寸没有意义，返回 None 跳过本次保存。
#[cfg(desktop)]
pub(crate) fn capture_window_geometry(window: &tauri::WebviewWindow) -> Option<WindowGeometry> {
    if window.is_minimized().unwrap_or(false) {
        return None;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    // 用内尺寸：tauri 的 set_size 设的就是内尺寸，二者配套才能原样往返
    let size = window.inner_size().ok()?;
    let position = window.outer_position().ok()?;
    let current = WindowGeometry {
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
        maximized,
        monitor: capture_monitor_ref(window, position),
    };
    if !maximized {
        if let Ok(mut slot) = GEOMETRY_LAST_NORMAL.lock() {
            *slot = Some(current.clone());
        }
        return Some(current);
    }
    // 最大化时的尺寸/坐标是铺满屏幕的值：改用最大化前的普通几何，
    // 这样用户之后点「还原」仍能得到原来的大小与位置。
    match GEOMETRY_LAST_NORMAL.lock().ok().and_then(|slot| slot.clone()) {
        Some(mut normal) => {
            normal.maximized = true;
            Some(normal)
        }
        None => Some(current),
    }
}

/// 防抖落盘：500ms 内的多次移动/缩放只写一次。
#[cfg(desktop)]
pub(crate) fn schedule_geometry_save(window: &tauri::WebviewWindow) {
    let Some(geometry) = capture_window_geometry(window) else {
        return;
    };
    if let Ok(mut slot) = GEOMETRY_PENDING.lock() {
        *slot = Some(geometry);
    }
    if GEOMETRY_TIMER_RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return; // 已有计时线程在等待，本次事件的值已并入待写入
    }
    std::thread::spawn(|| {
        std::thread::sleep(GEOMETRY_DEBOUNCE);
        GEOMETRY_TIMER_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
        let pending = GEOMETRY_PENDING.lock().ok().and_then(|mut slot| slot.take());
        if let Some(geometry) = pending {
            save_window_geometry(&geometry);
        }
    });
}

/// 关窗/退出等时机立即落盘：丢弃排队中的旧值，改写成当前值。
#[cfg(desktop)]
pub(crate) fn save_geometry_now(window: &tauri::WebviewWindow) {
    if let Ok(mut slot) = GEOMETRY_PENDING.lock() {
        *slot = None;
    }
    if let Some(geometry) = capture_window_geometry(window) {
        save_window_geometry(&geometry);
    }
}

/// 恢复主窗口几何。决策顺序：
/// 1. 读数据库 app_meta 里的 `window_geometry`；缺失/损坏/数值不合理 → 直接用默认几何，什么都不做；
/// 2. 采集当前显示器：物理矩形用于可见性判断，逻辑原点 + 当前 scale 用于 DPI 重映射；
/// 3. 若保存的显示器**名称能在当前 `available_monitors()` 里找到**且数值合法 →
///    **DPI 重映射**：逻辑尺寸 = 保存的物理尺寸 / 保存时的 scale，
///    逻辑位置 = 当前显示器逻辑原点 + 保存的逻辑偏移，用 `LogicalSize`/`LogicalPosition` 落位，
///    由系统按新缩放换算成物理像素；
/// 4. 找不到同名显示器（换显示器/单屏切换）或指纹缺失/非法 → **退回旧的物理像素逻辑**：
///    先 `set_size(PhysicalSize)`，位置按 40px（`VISIBLE_MARGIN`）重叠容错判断，
///    不可见则居中；
/// 5. 最后按保存的 `maximized` 决定是否最大化。
/// 任何一步失败都只写 `append_log`，不 panic、不弹窗。
#[cfg(desktop)]
pub(crate) fn restore_main_window_geometry(window: &tauri::WebviewWindow) {
    let Some(geometry) = read_window_geometry() else {
        return;
    };

    // 显示器信息只取一次：物理矩形给可见性判断，逻辑快照给重映射
    let (screens, snapshots) = match window.available_monitors() {
        Ok(monitors) => (
            monitors
                .iter()
                .map(|monitor| ScreenRect {
                    x: monitor.position().x,
                    y: monitor.position().y,
                    width: monitor.size().width,
                    height: monitor.size().height,
                })
                .collect::<Vec<ScreenRect>>(),
            monitors.iter().filter_map(snapshot_of).collect::<Vec<MonitorSnapshot>>(),
        ),
        Err(error) => {
            append_log(&format!("获取显示器信息失败: {error}"));
            (Vec::new(), Vec::new())
        }
    };

    // 先算重映射目标：命中同名显示器才走逻辑坐标，否则一律退回物理像素
    let target = remap_to_monitor(&geometry, &snapshots);

    let position_note = match target {
        Some(target) => {
            // 重映射路径：逻辑尺寸 + 逻辑坐标，交给系统按当前缩放渲染
            if let Err(error) = window.set_size(tauri::LogicalSize::new(target.width, target.height)) {
                append_log(&format!("恢复窗口尺寸失败: {error}"));
            }
            if let Err(error) = window.set_position(tauri::LogicalPosition::new(target.x, target.y)) {
                append_log(&format!("恢复窗口位置失败: {error}"));
            }
            let monitor_name = geometry
                .monitor
                .as_ref()
                .and_then(|monitor| monitor.name.as_deref())
                .unwrap_or("未知显示器");
            append_log(&format!(
                "窗口几何已按显示器 {monitor_name}（scale {}）重映射: {}x{} @ ({:.0},{:.0})",
                target.scale_factor, target.width, target.height, target.x, target.y
            ));
            format!("({:.0},{:.0})（逻辑重映射）", target.x, target.y)
        }
        None => {
            // 回退路径：沿用旧的物理像素逻辑
            if let Err(error) = window.set_size(tauri::PhysicalSize::new(geometry.width, geometry.height)) {
                append_log(&format!("恢复窗口尺寸失败: {error}"));
            }
            append_log(&format!(
                "窗口几何未重映射（{}），按物理像素恢复",
                remap_skip_reason(&geometry, &snapshots)
            ));
            if position_visible(
                geometry.x,
                geometry.y,
                geometry.width,
                geometry.height,
                &screens,
                VISIBLE_MARGIN,
            ) {
                if let Err(error) = window.set_position(tauri::PhysicalPosition::new(geometry.x, geometry.y)) {
                    append_log(&format!("恢复窗口位置失败: {error}"));
                }
                format!("({},{})", geometry.x, geometry.y)
            } else {
                // 保存的位置已不在任何显示器可见区域内：只应用大小，位置改为居中。
                if let Err(error) = window.center() {
                    append_log(&format!("窗口居中失败: {error}"));
                }
                format!("居中（原位置 ({},{}) 不在可见区域）", geometry.x, geometry.y)
            }
        }
    };

    // 记录普通状态几何，供之后最大化时保存使用
    if let Ok(mut slot) = GEOMETRY_LAST_NORMAL.lock() {
        *slot = Some(WindowGeometry { maximized: false, ..geometry.clone() });
    }

    if geometry.maximized {
        if let Err(error) = window.maximize() {
            append_log(&format!("恢复最大化失败: {error}"));
        }
    }

    append_log(&format!(
        "窗口几何已恢复: {}x{} @ {} 最大化={}",
        geometry.width, geometry.height, position_note, geometry.maximized
    ));
}

/// 没走重映射的原因，仅用于日志（判断口径与 `remap_to_monitor` 的提前返回一一对应）。
pub(crate) fn remap_skip_reason(geometry: &WindowGeometry, monitors: &[MonitorSnapshot]) -> String {
    let Some(saved) = geometry.monitor.as_ref() else {
        return "旧文件无显示器信息".to_string();
    };
    match saved.name.as_deref().filter(|name| !name.is_empty()) {
        None => "文件未记录显示器名称".to_string(),
        Some(name) => {
            if monitors.iter().any(|monitor| monitor.name.as_deref() == Some(name)) {
                // 名称能对上却仍被拒：只可能是 scale/偏移/换算结果非法
                "显示器指纹数值非法".to_string()
            } else {
                format!("当前没有名为 {name} 的显示器")
            }
        }
    }
}
