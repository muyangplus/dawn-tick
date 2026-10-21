//! 悬浮窗（mini）的窗口管理：内容自适应尺寸、手动尺寸记忆，以及显示/隐藏命令。
//!
//! 尺寸一律是**逻辑像素**（与 WebView 的 CSS 像素同口径），
//! 传给 Tauri 时用 `LogicalSize`，由它按显示器 DPI 换算成物理像素。
//!
//! 存储口径：与主窗口几何同表——数据库 `app_meta`，用 lib.rs 里同一对
//! `read_meta_value` / `write_meta_value` 短连接读写，键为 `widget_geometry`。
//! 值为 `{"variants":{"<样式>":{"width":268.0,"height":236.0}}}`，按样式各记一份。

use std::collections::BTreeMap;

use tauri::Manager;

/// 悬浮窗宽度的下限/上限（逻辑像素）。
pub const MIN_WIDGET_WIDTH: f64 = 200.0;
pub const MAX_WIDGET_WIDTH: f64 = 600.0;
/// 悬浮窗高度的下限/上限（逻辑像素）；高度还要再受屏幕可用高度约束。
pub const MIN_WIDGET_HEIGHT: f64 = 80.0;
pub const MAX_WIDGET_HEIGHT: f64 = 800.0;
/// 内容估算用的头部高度、单行高度与上下留白（逻辑像素）。
const HEADER_HEIGHT: f64 = 36.0;
const ROW_HEIGHT: f64 = 26.0;
const BODY_PADDING: f64 = 12.0;
/// 前端没给行数时的估算行数，以及允许的最大行数（再高的内容由 800 上限兜住）。
const DEFAULT_ROWS: u32 = 3;
const MAX_ROWS: u32 = 32;
/// 尺寸记忆的 app_meta 键：与主窗口几何（`window_geometry`）同表、同一套读写函数。
const WIDGET_GEOMETRY_KEY: &str = "widget_geometry";

/// 一种悬浮窗样式的静态规格：默认尺寸与缺省内容行数。
struct VariantSpec {
    variant: &'static str,
    width: f64,
    height: f64,
    /// 前端没传行数时按这个行数估算内容高度；`None` 表示高度固定、不随行数变化。
    default_rows: Option<u32>,
}

/// 样式表：新增样式只加一行，默认尺寸与缺省行数都收在这里，避免写死 if 链。
const VARIANTS: &[VariantSpec] = &[
    VariantSpec {
        variant: "bar",
        width: 240.0,
        height: 104.0,
        default_rows: Some(DEFAULT_ROWS),
    },
    VariantSpec {
        variant: "today",
        width: 268.0,
        height: 236.0,
        default_rows: Some(DEFAULT_ROWS),
    },
    VariantSpec {
        variant: "minimal",
        width: 196.0,
        height: 68.0,
        default_rows: None,
    },
    VariantSpec {
        variant: "combo",
        width: 288.0,
        height: 268.0,
        default_rows: Some(DEFAULT_ROWS),
    },
    // 考试倒计时：窄条，考试名 + 倒计时/日期两行
    VariantSpec {
        variant: "exam",
        width: 240.0,
        height: 96.0,
        default_rows: Some(2),
    },
];

/// 未知样式统一回退到表首项 bar。
const DEFAULT_VARIANT: &str = "bar";

fn variant_spec(variant: &str) -> &'static VariantSpec {
    VARIANTS
        .iter()
        .find(|spec| spec.variant == variant)
        .unwrap_or(&VARIANTS[0])
}

/// 各样式按内容的默认尺寸（逻辑像素）：没有记住尺寸时用它。
pub fn widget_size(variant: &str) -> (f64, f64) {
    let spec = variant_spec(variant);
    (spec.width, spec.height)
}

/// 尺寸（逻辑像素）。落盘形态固定为 `width` / `height` 两个数字。
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct WidgetSize {
    pub width: f64,
    pub height: f64,
}

/// 尺寸来源：默认 / 记住的 / 按内容 / 手动拉伸。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SizeSource {
    Default,
    Remembered,
    Content,
    Manual,
}

impl SizeSource {
    fn as_str(self) -> &'static str {
        match self {
            SizeSource::Default => "default",
            SizeSource::Remembered => "remembered",
            SizeSource::Content => "content",
            SizeSource::Manual => "manual",
        }
    }
}

/// 一次尺寸计算的结果，直接返回给前端；`width`/`height` 是**实际应用**的尺寸。
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetLayout {
    pub variant: String,
    /// 实际应用（夹取并取整后）的宽高，逻辑像素
    pub width: f64,
    pub height: f64,
    /// 夹取前请求的宽高，便于前端排查「为什么和我要的不一样」
    pub requested_width: f64,
    pub requested_height: f64,
    /// 尺寸来源：default / remembered / content / manual
    pub source: String,
    /// 是否被上下限或屏幕高度夹取过
    pub clamped: bool,
    /// 当前屏幕允许的最大逻辑高度（已含 800 上限）
    pub max_height: f64,
    /// 记住的尺寸（没有则为 null）
    pub remembered: Option<WidgetSize>,
}

/// 屏幕可用高度对应的最大逻辑高度：拿不到显示器信息或数值异常时退回 800。
fn max_height_for(screen_height: Option<f64>) -> f64 {
    let logical = screen_height.filter(|value| value.is_finite() && *value > 0.0);
    match logical {
        Some(value) => value.clamp(MIN_WIDGET_HEIGHT, MAX_WIDGET_HEIGHT),
        None => MAX_WIDGET_HEIGHT,
    }
}

fn clamp_axis(value: f64, min: f64, max: f64) -> f64 {
    if !value.is_finite() {
        return min;
    }
    // max 可能小于 min（极端小的屏幕），以 min 兜底
    value.max(min).min(max.max(min))
}

/// 按上下限与屏幕可用高度夹取尺寸，结果取整到整数逻辑像素（避免半像素模糊）。
pub fn clamp_widget_size(width: f64, height: f64, screen_height: Option<f64>) -> (f64, f64) {
    let max_height = max_height_for(screen_height);
    (
        clamp_axis(width, MIN_WIDGET_WIDTH, MAX_WIDGET_WIDTH).round(),
        clamp_axis(height, MIN_WIDGET_HEIGHT, max_height).round(),
    )
}

/// 按行数估算内容高度（逻辑像素）：头部 + 上下留白 + 行高 × 行数。
/// 行数缺省时用该样式的 `default_rows`；`minimal` 高度固定，行数不影响高度；最多按 32 行算。
pub fn content_height(variant: &str, rows: Option<u32>) -> f64 {
    let spec = variant_spec(variant);
    let Some(default_rows) = spec.default_rows else {
        return spec.height;
    };
    let rows = rows.unwrap_or(default_rows).min(MAX_ROWS);
    HEADER_HEIGHT + BODY_PADDING + ROW_HEIGHT * rows as f64
}

/// 组装布局结果：夹取 + 取整 + 标记来源与被夹取状态。
fn layout_of(
    variant: &str,
    requested: WidgetSize,
    source: SizeSource,
    screen_height: Option<f64>,
    remembered: Option<WidgetSize>,
) -> WidgetLayout {
    let (width, height) = clamp_widget_size(requested.width, requested.height, screen_height);
    WidgetLayout {
        variant: variant.to_string(),
        width,
        height,
        requested_width: requested.width,
        requested_height: requested.height,
        source: source.as_str().to_string(),
        clamped: (width - requested.width).abs() > 0.5 || (height - requested.height).abs() > 0.5,
        max_height: max_height_for(screen_height),
        remembered,
    }
}

/// 启动显示用的布局：有记忆尺寸用记忆的，没有用该样式的默认尺寸。
pub fn remembered_layout(
    variant: &str,
    remembered: Option<WidgetSize>,
    screen_height: Option<f64>,
) -> WidgetLayout {
    let (default_width, default_height) = widget_size(variant);
    let (source, requested) = match remembered {
        Some(size) => (SizeSource::Remembered, size),
        None => (
            SizeSource::Default,
            WidgetSize {
                width: default_width,
                height: default_height,
            },
        ),
    };
    layout_of(variant, requested, source, screen_height, remembered)
}

/// 内容自适应布局：高度按行数估算，宽度优先沿用当前窗口宽度，其次记忆宽度，最后默认宽度。
pub fn content_layout(
    variant: &str,
    rows: Option<u32>,
    current_width: Option<f64>,
    remembered: Option<WidgetSize>,
    screen_height: Option<f64>,
) -> WidgetLayout {
    let width = current_width
        .filter(|value| value.is_finite() && *value > 0.0)
        .or_else(|| remembered.map(|size| size.width))
        .unwrap_or_else(|| widget_size(variant).0);
    let requested = WidgetSize {
        width,
        height: content_height(variant, rows),
    };
    layout_of(variant, requested, SizeSource::Content, screen_height, remembered)
}

/// 手动拉伸后的布局：用户给的宽高夹取后即为结果。
pub fn manual_layout(
    variant: &str,
    requested: WidgetSize,
    remembered: Option<WidgetSize>,
    screen_height: Option<f64>,
) -> WidgetLayout {
    layout_of(variant, requested, SizeSource::Manual, screen_height, remembered)
}

/// 尺寸记忆表：按样式各存一份。未知字段忽略，缺省为空表。
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct WidgetGeometryStore {
    #[serde(default)]
    variants: BTreeMap<String, WidgetSize>,
}

/// 解析记忆文本：损坏、字段不合法（非有限/非正）一律丢弃，绝不 panic。
fn parse_store(text: &str) -> WidgetGeometryStore {
    let Ok(store) = serde_json::from_str::<WidgetGeometryStore>(text) else {
        return WidgetGeometryStore::default();
    };
    let mut clean = WidgetGeometryStore::default();
    for (variant, size) in store.variants {
        if size.width.is_finite() && size.height.is_finite() && size.width > 0.0 && size.height > 0.0 {
            clean.variants.insert(variant, size);
        }
    }
    clean
}

fn store_json(store: &WidgetGeometryStore) -> Option<String> {
    serde_json::to_string(store).ok()
}

/// 读记忆表：读不到或损坏都按空表处理。
async fn load_store() -> WidgetGeometryStore {
    match crate::read_meta_value(WIDGET_GEOMETRY_KEY).await {
        Some(text) => parse_store(&text),
        None => WidgetGeometryStore::default(),
    }
}

/// 写记忆表；失败只记日志，不影响本次尺寸生效。
async fn save_store(store: &WidgetGeometryStore) -> bool {
    let Some(text) = store_json(store) else {
        crate::append_log("悬浮窗尺寸序列化失败，本次不记忆");
        return false;
    };
    crate::write_meta_value(WIDGET_GEOMETRY_KEY, &text).await
}

fn remembered_size(store: &WidgetGeometryStore, variant: &str) -> Option<WidgetSize> {
    store.variants.get(variant).copied()
}

/// 屏幕可用高度（逻辑像素）：优先窗口所在显示器，拿不到退回主显示器。
fn screen_logical_height(window: &tauri::WebviewWindow) -> Option<f64> {
    let monitor = match window.current_monitor() {
        Ok(Some(monitor)) => monitor,
        _ => window.primary_monitor().ok().flatten()?,
    };
    let scale = monitor.scale_factor();
    if !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    Some(monitor.size().height as f64 / scale)
}

/// 当前窗口宽度（逻辑像素）。
fn window_logical_width(window: &tauri::WebviewWindow) -> Option<f64> {
    let scale = window.scale_factor().ok()?;
    if !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    let size = window.inner_size().ok()?;
    Some(size.to_logical::<f64>(scale).width)
}

fn apply_size(window: &tauri::WebviewWindow, layout: &WidgetLayout) -> Result<(), String> {
    window
        .set_size(tauri::LogicalSize::new(layout.width, layout.height))
        .map_err(|error| format!("调整悬浮窗尺寸失败: {error}"))
}

#[cfg(desktop)]
pub(crate) fn ensure_mini(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    if let Some(window) = app.get_webview_window("mini") {
        return Some(window);
    }
    let (width, height) = widget_size(DEFAULT_VARIANT);
    let built = WebviewWindowBuilder::new(app, "mini", WebviewUrl::App("mini.html".into()))
        .title("晓刻 DawnTick · 悬浮窗")
        .inner_size(width, height)
        // 允许用户拉伸手柄（Web 侧调 startResizeDragging），但尺寸被夹在上下限之间
        .min_inner_size(MIN_WIDGET_WIDTH, MIN_WIDGET_HEIGHT)
        .max_inner_size(MAX_WIDGET_WIDTH, MAX_WIDGET_HEIGHT)
        .resizable(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .transparent(true)
        .visible(false)
        .build();
    match built {
        Ok(window) => {
            // 首次出现放在主屏右下角，避免出现在奇怪的位置
            if let Ok(Some(monitor)) = window.primary_monitor() {
                let size = monitor.size();
                let scale = monitor.scale_factor();
                let physical_width = (width * scale) as i32;
                let physical_height = (height * scale) as i32;
                let x = size.width as i32 - physical_width;
                let y = size.height as i32 - physical_height;
                let _ = window.set_position(tauri::PhysicalPosition::new(x.max(0), y.max(0)));
            }
            Some(window)
        }
        Err(error) => {
            crate::append_log(&format!("创建悬浮窗失败: {error}"));
            None
        }
    }
}

fn variant_key(variant: Option<String>) -> String {
    variant
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| DEFAULT_VARIANT.to_string())
}

/// 按内容调整悬浮窗高度（并沿用当前/记忆的宽度），不写入记忆、不显示窗口。
///
/// 前端算好实际渲染行数后调用；返回的 `width`/`height` 是实际应用的尺寸，
/// 前端应据此设置自身根节点尺寸，避免内容被裁切或留白。
#[tauri::command]
pub async fn widget_measure(
    app: tauri::AppHandle,
    variant: Option<String>,
    content_rows: Option<u32>,
) -> Result<WidgetLayout, String> {
    let key = variant_key(variant);
    let window = ensure_mini(&app).ok_or_else(|| "悬浮窗不可用".to_string())?;
    let screen_height = screen_logical_height(&window);
    let store = load_store().await;
    let remembered = remembered_size(&store, &key);
    let current_width = window_logical_width(&window);
    let layout = content_layout(&key, content_rows, current_width, remembered, screen_height);
    apply_size(&window, &layout)?;
    crate::append_log(&format!(
        "悬浮窗尺寸按内容调整: {}x{}（样式 {key}，行数 {}，来源 {}）",
        layout.width,
        layout.height,
        content_rows
            .map(|rows| rows.to_string())
            .unwrap_or_else(|| "缺省".to_string()),
        layout.source
    ));
    Ok(layout)
}

/// 用户手动拉伸后持久化尺寸：夹取后应用到窗口，并写入 `app_meta` 按样式记忆。
#[tauri::command]
pub async fn widget_resize(
    app: tauri::AppHandle,
    width: f64,
    height: f64,
    variant: Option<String>,
) -> Result<WidgetLayout, String> {
    let key = variant_key(variant);
    let window = ensure_mini(&app).ok_or_else(|| "悬浮窗不可用".to_string())?;
    let screen_height = screen_logical_height(&window);
    let mut store = load_store().await;
    let requested = WidgetSize { width, height };
    let (clamped_width, clamped_height) = clamp_widget_size(width, height, screen_height);
    let size = WidgetSize {
        width: clamped_width,
        height: clamped_height,
    };
    store.variants.insert(key.clone(), size);
    let saved = save_store(&store).await;
    let layout = manual_layout(&key, requested, Some(size), screen_height);
    apply_size(&window, &layout)?;
    if saved {
        crate::append_log(&format!(
            "悬浮窗尺寸已记忆: {}x{}（样式 {key}）",
            layout.width, layout.height
        ));
    } else {
        crate::append_log("悬浮窗尺寸写入 app_meta 失败，本次仅生效不记忆");
    }
    Ok(layout)
}

/// 按当前样式调整悬浮窗大小并显示：优先用记住的尺寸，没有则用按内容的默认尺寸。
#[tauri::command]
pub async fn show_widget(app: tauri::AppHandle, variant: Option<String>) -> Result<(), String> {
    let key = variant_key(variant);
    let window = ensure_mini(&app).ok_or_else(|| "悬浮窗不可用".to_string())?;
    let screen_height = screen_logical_height(&window);
    let store = load_store().await;
    let remembered = remembered_size(&store, &key);
    let layout = remembered_layout(&key, remembered, screen_height);
    apply_size(&window, &layout)?;
    window
        .show()
        .map_err(|error| format!("显示悬浮窗失败: {error}"))?;
    let _ = window.set_focus();
    crate::append_log(&format!(
        "已显示悬浮窗（{key}，{}x{}，来源 {}）",
        layout.width, layout.height, layout.source
    ));
    Ok(())
}

/// 隐藏悬浮窗。
#[tauri::command]
pub async fn hide_widget(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("mini") {
        window
            .hide()
            .map_err(|error| format!("隐藏悬浮窗失败: {error}"))?;
        crate::append_log("已隐藏悬浮窗");
    }
    Ok(())
}

/// 从悬浮窗打开主窗口：还原最小化、显示并前置。
#[tauri::command]
pub async fn show_main(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(crate::MAIN_WINDOW)
        .ok_or_else(|| "主窗口不可用".to_string())?;
    let _ = window.unminimize();
    window
        .show()
        .map_err(|error| format!("显示主窗口失败: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("聚焦主窗口失败: {error}"))?;
    crate::append_log("从悬浮窗打开主窗口");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_sizes_are_stable() {
        assert_eq!(widget_size("bar"), (240.0, 104.0));
        assert_eq!(widget_size("today"), (268.0, 236.0));
        assert_eq!(widget_size("minimal"), (196.0, 68.0));
        assert_eq!(widget_size("combo"), (288.0, 268.0));
        // 考试倒计时：窄条
        assert_eq!(widget_size("exam"), (240.0, 96.0));
        // 未知样式按 bar 处理
        assert_eq!(widget_size("nope"), (240.0, 104.0));
    }

    #[test]
    fn exam_variant_uses_two_rows_with_one_row_empty_state() {
        // 考试名 + 倒计时/日期两行：36 + 12 + 26 × 2
        assert_eq!(content_height("exam", Some(2)), 100.0);
        // 前端没传行数时按样式表里的 2 行兜底
        assert_eq!(content_height("exam", None), 100.0);
        // 无考试空态一行
        assert_eq!(content_height("exam", Some(1)), 74.0);
        // 默认布局同样走样式表（show_widget 首次显示的口径）
        let layout = remembered_layout("exam", None, Some(1080.0));
        assert_eq!((layout.width, layout.height), (240.0, 96.0));
        assert_eq!(layout.source, "default");
        // 未知样式继续按 bar 的尺寸与行数口径
        assert_eq!(widget_size("unknown"), widget_size("bar"));
        assert_eq!(content_height("unknown", Some(2)), content_height("bar", Some(2)));
    }

    #[test]
    fn size_is_clamped_into_allowed_range() {
        // 正常尺寸原样保留（取整）
        assert_eq!(clamp_widget_size(268.0, 236.0, Some(1080.0)), (268.0, 236.0));
        // 下限
        assert_eq!(clamp_widget_size(10.0, 10.0, None), (200.0, 80.0));
        // 上限
        assert_eq!(clamp_widget_size(9999.0, 9999.0, None), (600.0, 800.0));
        // 屏幕可用高度小于 800 时按屏幕高度夹取
        assert_eq!(clamp_widget_size(300.0, 700.0, Some(500.0)), (300.0, 500.0));
        // 屏幕比最小高度还小：仍保底 80，不产出 0 尺寸窗口
        assert_eq!(clamp_widget_size(300.0, 400.0, Some(50.0)), (300.0, 80.0));
        // 异常显示器数据：NaN / 0 / 负数 / 无穷都不能产出非法尺寸
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 0.0, -100.0] {
            assert_eq!(clamp_widget_size(300.0, 400.0, Some(bad)), (300.0, 400.0), "{bad}");
        }
        // 非有限输入回落到下限
        assert_eq!(clamp_widget_size(f64::NAN, f64::NAN, None), (200.0, 80.0));
        // 小数取整，避免半像素模糊
        assert_eq!(clamp_widget_size(268.4, 235.6, None), (268.0, 236.0));
    }

    #[test]
    fn content_height_tracks_rows() {
        // 头部 36 + 留白 12 + 26 × 行数
        assert_eq!(content_height("bar", Some(0)), 48.0);
        assert_eq!(content_height("bar", Some(5)), 178.0);
        assert_eq!(content_height("today", Some(1)), 74.0);
        // 缺省 3 行
        assert_eq!(content_height("combo", None), 126.0);
        // 行数封顶，不会算出离谱高度（再经 clamp 仍被 800 兜住）
        assert_eq!(content_height("bar", Some(1000)), 36.0 + 12.0 + 26.0 * 32.0);
        // minimal 只有一行大数字，行数不影响高度
        assert_eq!(content_height("minimal", Some(10)), widget_size("minimal").1);
        assert_eq!(content_height("minimal", None), widget_size("minimal").1);
    }

    #[test]
    fn remembered_layout_prefers_saved_size() {
        let saved = WidgetSize {
            width: 320.0,
            height: 240.0,
        };
        let layout = remembered_layout("today", Some(saved), Some(1080.0));
        assert_eq!((layout.width, layout.height), (320.0, 240.0));
        assert_eq!(layout.source, "remembered");
        assert_eq!(layout.remembered, Some(saved));
        assert!(!layout.clamped);
        assert_eq!(layout.max_height, 800.0);

        // 没有记忆：用该样式的默认尺寸
        let fallback = remembered_layout("today", None, Some(1080.0));
        assert_eq!((fallback.width, fallback.height), (268.0, 236.0));
        assert_eq!(fallback.source, "default");
        assert_eq!(fallback.remembered, None);
    }

    #[test]
    fn remembered_out_of_range_size_is_clamped() {
        let huge = WidgetSize {
            width: 1000.0,
            height: 2000.0,
        };
        let layout = remembered_layout("bar", Some(huge), Some(1080.0));
        assert_eq!((layout.width, layout.height), (600.0, 800.0));
        assert!(layout.clamped, "超界尺寸应标记为已夹取");
        assert_eq!(layout.requested_width, 1000.0);
        assert_eq!(layout.requested_height, 2000.0);

        // 记忆尺寸也要受当前屏幕高度约束
        let tall = WidgetSize {
            width: 300.0,
            height: 700.0,
        };
        let on_small_screen = remembered_layout("bar", Some(tall), Some(480.0));
        assert_eq!(on_small_screen.height, 480.0);
        assert_eq!(on_small_screen.max_height, 480.0);
    }

    #[test]
    fn content_layout_keeps_width_source_priority() {
        let remembered = WidgetSize {
            width: 300.0,
            height: 200.0,
        };
        // 当前窗口宽度优先（用户拉伸过的宽度不被内容自适应重置）
        let layout = content_layout("today", Some(4), Some(360.0), Some(remembered), Some(1080.0));
        assert_eq!(layout.width, 360.0);
        assert_eq!(layout.height, 36.0 + 12.0 + 26.0 * 4.0);
        assert_eq!(layout.source, "content");

        // 没有当前宽度时沿用记忆宽度
        let from_memory = content_layout("today", Some(4), None, Some(remembered), Some(1080.0));
        assert_eq!(from_memory.width, 300.0);

        // 都没有时用样式默认宽度
        let from_default = content_layout("today", Some(4), None, None, Some(1080.0));
        assert_eq!(from_default.width, widget_size("today").0);

        // 越界宽度被夹取并标记
        let narrow = content_layout("bar", Some(0), Some(50.0), None, None);
        assert_eq!((narrow.width, narrow.height), (200.0, 80.0));
        assert!(narrow.clamped);

        // 内容过高：按屏幕高度夹取
        let tall = content_layout("bar", Some(32), Some(300.0), None, Some(400.0));
        assert_eq!(tall.height, 400.0);
        assert_eq!(tall.max_height, 400.0);
        assert!(tall.clamped);
    }

    #[test]
    fn manual_layout_returns_clamped_size() {
        let requested = WidgetSize {
            width: 333.0,
            height: 222.0,
        };
        let layout = manual_layout("combo", requested, Some(requested), None);
        assert_eq!((layout.width, layout.height), (333.0, 222.0));
        assert_eq!(layout.source, "manual");
        assert_eq!(layout.remembered, Some(requested));
        assert!(!layout.clamped);

        let too_wide = manual_layout(
            "combo",
            WidgetSize {
                width: 5000.0,
                height: 10.0,
            },
            None,
            None,
        );
        assert_eq!((too_wide.width, too_wide.height), (600.0, 80.0));
        assert!(too_wide.clamped);
    }

    #[test]
    fn layout_serializes_camel_case_contract() {
        let layout = remembered_layout("bar", None, None);
        let value = serde_json::to_value(&layout).expect("应能序列化");
        assert_eq!(value["variant"], "bar");
        assert_eq!(value["width"], 240.0);
        assert_eq!(value["height"], 104.0);
        assert_eq!(value["requestedWidth"], 240.0);
        assert_eq!(value["requestedHeight"], 104.0);
        assert_eq!(value["source"], "default");
        assert_eq!(value["clamped"], false);
        assert_eq!(value["maxHeight"], 800.0);
        assert!(value["remembered"].is_null());
    }

    #[test]
    fn store_parses_and_roundtrips() {
        let text = r#"{"variants":{"today":{"width":300.0,"height":220.0},"bar":{"width":260.0,"height":120.0}}}"#;
        let store = parse_store(text);
        assert_eq!(
            remembered_size(&store, "today"),
            Some(WidgetSize {
                width: 300.0,
                height: 220.0
            })
        );
        assert_eq!(
            remembered_size(&store, "bar"),
            Some(WidgetSize {
                width: 260.0,
                height: 120.0
            })
        );
        assert_eq!(remembered_size(&store, "combo"), None);
        // 写回形态稳定
        let json = store_json(&store).expect("应能序列化");
        assert_eq!(parse_store(&json), store);
    }

    #[test]
    fn broken_store_falls_back_to_empty() {
        assert!(parse_store("not json").variants.is_empty());
        assert!(parse_store("{}").variants.is_empty());
        assert!(parse_store(r#"{"variants":[]}"#).variants.is_empty());
        // 非法尺寸（非正数）被丢弃，同表的合法项保留
        let mixed = parse_store(
            r#"{"variants":{"today":{"width":0.0,"height":200.0},"bar":{"width":-10.0,"height":100.0},"combo":{"width":300.0,"height":260.0}}}"#,
        );
        assert_eq!(remembered_size(&mixed, "today"), None);
        assert_eq!(remembered_size(&mixed, "bar"), None);
        assert_eq!(
            remembered_size(&mixed, "combo"),
            Some(WidgetSize {
                width: 300.0,
                height: 260.0
            })
        );
    }
}
