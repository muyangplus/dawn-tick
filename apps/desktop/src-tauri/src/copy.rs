//! 桌面壳的界面文案：系统弹窗、托盘、窗口标题，以及回给前端原样展示的错误。
//! 日志文案不在这里。带变量的句子写成返回 `String` 的函数。

// 部分文案只在 Windows 目标上用到
#![allow(dead_code)]

use std::fmt::Display;

pub(crate) mod app {
    /// 产品名；也是主窗口标题（与 `tauri.conf.json` 的 `title` 一致，`FindWindowW` 按它找窗口）。
    pub const NAME: &str = "晓刻 DawnTick";
}

pub(crate) mod common {
    use super::Display;

    pub const UNSUPPORTED_PLATFORM: &str = "当前平台不支持";
    pub const INVALID_BASE64: &str = "内容不是合法的 Base64";

    pub fn background_task_failed(error: impl Display) -> String {
        format!("后台任务失败：{error}")
    }

    pub fn program_path_failed(error: impl Display) -> String {
        format!("获取程序路径失败：{error}")
    }
}

/// 启动期的系统错误弹窗。
pub(crate) mod startup {
    use super::Display;

    pub const CANNOT_START_TITLE: &str = "晓刻 DawnTick 无法启动";
    pub const ALREADY_RUNNING_TITLE: &str = "晓刻 DawnTick 已在运行";
    pub const DATABASE_LOCKED_TITLE: &str = "晓刻 DawnTick 无法打开数据库";
    pub const START_FAILED_TITLE: &str = "晓刻 DawnTick 启动失败";

    pub const ALREADY_RUNNING: &str = "晓刻已在运行，但没能唤回它的窗口。\n\n\
         请在任务管理器结束 DawnTick.exe 后重试。";

    pub const DATABASE_NOT_WRITABLE: &str = "数据库文件不可写，可能被其他程序占用。\n\n\
         本次启动未打开数据库。请关闭占用数据库的程序后重试。";

    pub fn elevation_failed(reason: impl Display, error: impl Display) -> String {
        format!(
            "{reason}。\n申请管理员权限失败：{error}。\n\n\
             本次启动已停止，未打开数据库。请把程序移到可写目录，或以管理员身份运行。"
        )
    }

    pub fn run_failed(error: impl Display) -> String {
        format!("运行失败：{error}。请重新打开晓刻。")
    }

    /// 便携版放在受限目录时 WebView2 建不了数据目录，panic 弹窗追加这段。
    pub const WEBVIEW_ACCESS_DENIED_HINT: &str = "\n\n程序所在目录可能不允许 WebView2 写入。\n\
         请把整个程序文件夹移到桌面或「文档」下的新文件夹后再运行。";

    pub fn data_root_line(hint: impl Display) -> String {
        format!("\n\n数据目录与日志：{hint}")
    }

    pub fn data_dir_part(dir: impl Display) -> String {
        format!("数据目录 {dir}")
    }

    pub fn log_fallback_dir_part(base: impl Display) -> String {
        format!("日志回退目录 {base}\\com.dawntick.app")
    }

    pub fn program_dir_part(dir: impl Display) -> String {
        format!("程序目录 {dir}")
    }

    pub const PART_SEPARATOR: &str = "；";
}

/// 单实例锁：原因会拼进启动错误弹窗。
pub(crate) mod instance {
    use super::Display;

    pub fn data_dir_not_writable(reason: impl Display) -> String {
        format!("数据目录不可写：{reason}")
    }

    pub fn lock_unavailable(reason: impl Display, lock: impl Display) -> String {
        format!(
            "无法在数据目录建立实例锁：{reason}\n\n\
             本次启动已停止，未打开数据库。\n\
             请把程序移到可写目录，或以管理员身份运行后重试。\n\n\
             锁文件：{lock}"
        )
    }

    pub fn handoff_timeout(seconds: u64, lock: impl Display) -> String {
        format!(
            "旧实例 {seconds} 秒内没有退出，本次未打开数据库。\n\
             请关闭所有晓刻窗口后重试，必要时在任务管理器结束 DawnTick.exe。\n\n\
             锁文件：{lock}"
        )
    }

    pub fn handoff_lock_failed(reason: impl Display) -> String {
        format!("旧实例已退出，但实例锁建立失败：{reason}。\n本次未打开数据库，请重新打开晓刻。")
    }

    pub fn takeover_failed(reason: impl Display) -> String {
        format!("接管实例锁失败：{reason}。\n本次未打开数据库，请重新打开晓刻。")
    }

    pub fn create_dir_failed(error: impl Display) -> String {
        format!("创建数据目录失败（{error}）")
    }

    pub fn open_lock_failed(error: impl Display) -> String {
        format!("打开锁文件失败（{error}）")
    }

    pub const OCCUPIED: &str = "数据目录已被另一个实例占用";

    pub fn lock_failed(error: impl Display) -> String {
        format!("加锁失败（{error}）")
    }
}

pub(crate) mod window {
    pub const IMPORT_TITLE: &str = "登录教务并打开课表页";
    pub const WIDGET_TITLE: &str = "晓刻 DawnTick · 悬浮窗";
    pub const DEV_CONSOLE_TITLE: &str = "晓刻 DawnTick 日志";
    pub const DEV_CONSOLE_ATTACHED: &str = "晓刻 DawnTick 日志已连接到本控制台";
}

pub(crate) mod tray {
    pub const TOOLTIP: &str = super::app::NAME;
    pub const SHOW_MAIN: &str = "显示主窗口";
    pub const SHOW_MINI: &str = "显示悬浮窗";
    pub const HIDE_MINI: &str = "隐藏悬浮窗";
    pub const QUIT: &str = "退出";
    pub const REMINDERS: &str = "提醒";
    pub const NO_PENDING: &str = "暂无待提醒";
    /// 设置页「托盘状态」括号里的说明。
    pub const NOT_INITIALIZED: &str = "尚未初始化";
}

/// 托盘提醒子菜单的动作；与 Android `ReminderActionTable` 同一口径。
pub(crate) mod reminder {
    pub const SNOOZE: &str = "贪睡 10 分钟";
    pub const DONE: &str = "完成";
    pub const MUTE: &str = "勿扰 60 分钟";
}

pub(crate) mod autostart {
    use super::Display;

    pub const UNSUPPORTED: &str = "当前平台不支持开机自启";

    pub fn open_key_failed(status: impl Display) -> String {
        format!("打开注册表启动项失败（代码 {status}）")
    }

    pub fn write_failed(status: impl Display) -> String {
        format!("写入启动项失败（代码 {status}）")
    }
}

pub(crate) mod elevation {
    use super::Display;

    pub const ALREADY_ELEVATED: &str = "已是管理员权限";

    pub fn request_failed(code: impl Display) -> String {
        format!("申请管理员权限被取消或失败（代码 {code}）")
    }
}

pub(crate) mod shell {
    use super::Display;

    pub const OPEN_BROWSER: &str = "打开默认浏览器";
    pub const OPEN_LOG_DIR: &str = "打开日志目录";
    pub const OPEN_DATA_DIR: &str = "打开数据目录";
    pub const START_INSTALLER: &str = "启动安装程序";
    pub const HTTP_ONLY: &str = "只支持 http 与 https 链接";

    /// `what` 取上面的动作名。
    pub fn open_failed(what: &str, code: impl Display) -> String {
        format!("{what}失败（代码 {code}）")
    }
}

/// 快照恢复与启动自检的结论。
pub(crate) mod backup {
    use super::Display;

    pub const INVALID_NAME: &str = "快照名不合法";
    pub const NOT_FOUND: &str = "快照不存在";
    pub const EMPTY: &str = "快照是空文件，无法恢复";
    pub const CORRUPT: &str = "快照已损坏，无法恢复";
    pub const QUEUE_FAILED: &str = "写入恢复请求失败，请检查数据目录是否可写";

    pub fn repair_keep_failed(error: impl Display) -> String {
        format!("数据库已损坏，原文件留存失败：{error}。请重启晓刻后再试")
    }

    pub fn repaired(snapshot: impl Display, saved: impl Display) -> String {
        format!("数据库已损坏，已用快照 {snapshot} 恢复。原文件留存为 {saved}")
    }

    pub fn repair_copy_failed(error: impl Display, saved: impl Display) -> String {
        format!("数据库已损坏，用快照恢复失败：{error}。原文件留存为 {saved}，请打开数据目录手动处理")
    }

    pub fn repair_no_snapshot(saved: impl Display) -> String {
        format!("数据库已损坏，没有可用的快照。原文件留存为 {saved}")
    }
}

/// 运行中恢复（`recover_database`）返回给界面的原因。
pub(crate) mod recover {
    use super::Display;

    pub const NO_DATABASE: &str = "数据库文件不存在，无需恢复";
    pub const HEALTHY: &str = "数据库自检通过，无需恢复";
    pub const NO_SNAPSHOT: &str = "没有找到通过自检的备份快照，请打开数据目录手动处理";

    pub fn keep_failed(error: impl Display) -> String {
        format!("损坏文件留存失败：{error}。请关闭占用数据库的程序后重试")
    }

    pub fn copy_failed(error: impl Display, saved: impl Display) -> String {
        format!("复制快照失败：{error}。损坏的数据库已留存为 {saved}，请打开数据目录手动处理")
    }
}

/// 自定义存储位置。
pub(crate) mod storage {
    use super::Display;

    pub fn create_dir_failed(error: impl Display) -> String {
        format!("创建目录失败（{error}）")
    }

    pub fn write_failed(error: impl Display) -> String {
        format!("写入失败（{error}）")
    }

    pub fn custom_unavailable(error: impl Display) -> String {
        format!("自定义存储位置不可用：{error}。已改用默认位置")
    }

    pub fn save_failed(error: impl Display) -> String {
        format!("保存存储位置失败：{error}")
    }

    pub const CONFIG_WRITE_FAILED: &str = "保存存储位置失败：配置文件写不进去";
}

/// 内嵌教务窗口。
pub(crate) mod import {
    use super::Display;

    pub const NONCE_MISMATCH: &str = "内容不是从本次打开的教务窗口交回的，请重新打开教务窗口";
    pub const MARKER_MISSING: &str = "内容缺少标记，请重新打开教务窗口";

    pub fn forward_failed(error: impl Display) -> String {
        format!("交回主窗口失败：{error}")
    }

    pub fn invalid_url(error: impl Display) -> String {
        format!("教务网址不正确：{error}")
    }

    pub fn open_failed(error: impl Display) -> String {
        format!("打开教务窗口失败：{error}")
    }
}

/// 导出文件（「另存为」）。
pub(crate) mod files {
    use super::Display;

    pub const NOTHING_TO_WRITE: &str = "没有要写入的内容";

    pub fn location_unavailable(error: impl Display) -> String {
        format!("保存位置不可用：{error}，请换一个位置")
    }

    pub fn write_failed(error: impl Display) -> String {
        format!("写入文件失败：{error}，请换一个位置")
    }
}

/// 自动更新：暂存、校验、安装版与便携版替换。
pub(crate) mod update {
    use super::Display;

    pub fn read_failed(error: impl Display) -> String {
        format!("读取更新包失败：{error}")
    }

    pub const SHA256_MISSING: &str = "缺少有效的 SHA-256 校验值";

    pub fn invalid_name(name: impl Display) -> String {
        format!("更新包文件名不合法：{name}")
    }

    pub fn not_found(name: impl Display) -> String {
        format!("更新包不存在：{name}，请重新下载")
    }

    pub const STAGING_MISSING: &str = "更新暂存目录不存在，请重新下载";
    pub const OUTSIDE_STAGING: &str = "更新包不在更新暂存目录，请重新下载";

    pub fn wrong_type(allowed: impl Display) -> String {
        format!("更新包类型不对：只接受 {allowed}")
    }

    /// 单测按「校验失败」匹配。
    pub const TAMPERED: &str = "更新包校验失败：文件在下载后被改动，请重新下载";

    pub fn create_staging_failed(error: impl Display) -> String {
        format!("创建更新暂存目录失败：{error}")
    }

    pub fn clear_staging_failed(error: impl Display) -> String {
        format!("清空更新暂存目录失败：{error}")
    }

    pub fn write_failed(error: impl Display) -> String {
        format!("写入更新包失败：{error}")
    }

    pub fn installer_failed(error: impl Display) -> String {
        format!("启动安装程序失败：{error}")
    }

    pub const PORTABLE_EMPTY_NAME: &str = "便携包里有空文件名";

    /// 单测按「非法路径」匹配。
    pub fn portable_bad_path(name: impl Display) -> String {
        format!("便携包含有非法路径：{name}")
    }

    pub fn portable_open_failed(error: impl Display) -> String {
        format!("打开便携包失败：{error}")
    }

    pub fn portable_not_zip(error: impl Display) -> String {
        format!("便携包不是有效的 zip：{error}，请重新下载")
    }

    pub fn portable_entry_failed(error: impl Display) -> String {
        format!("读取便携包条目失败：{error}")
    }

    pub fn portable_missing_exe(exe: impl Display) -> String {
        format!("便携包里缺少 {exe}，请重新下载")
    }

    pub fn create_dir_failed(error: impl Display) -> String {
        format!("创建目录失败：{error}")
    }

    pub fn write_staged_failed(error: impl Display) -> String {
        format!("写入暂存文件失败：{error}")
    }

    pub fn extract_failed(error: impl Display) -> String {
        format!("解压暂存文件失败：{error}")
    }

    pub fn extracted_exe_missing(exe: impl Display) -> String {
        format!("便携包解压后找不到 {exe}，请重新下载")
    }

    pub fn script_launch_failed(error: impl Display, script: impl Display) -> String {
        format!("启动更新脚本失败：{error}。脚本已保存在 {script}，可手动运行")
    }

    pub fn script_write_failed(error: impl Display) -> String {
        format!("写入更新脚本失败：{error}")
    }

    pub const PORTABLE_UNSUPPORTED: &str = "当前平台不支持便携版自动替换，请到发布页手动下载";
}

/// WebDAV 密码的系统密钥加解密。
pub(crate) mod secret {
    use super::Display;

    pub fn encrypt_failed(code: impl Display) -> String {
        format!("DPAPI 加密失败（错误码 {code}）")
    }

    pub fn decrypt_failed(code: impl Display) -> String {
        format!("DPAPI 解密失败（错误码 {code}）：密码可能来自别的 Windows 账户或设备")
    }

    pub const ENCRYPT_UNSUPPORTED: &str = "当前平台不支持系统密钥加密";
    pub const DECRYPT_UNSUPPORTED: &str = "当前平台不支持系统密钥解密";
    pub const CIPHERTEXT_NOT_BASE64: &str = "密文不是合法的 Base64";
    pub const PLAINTEXT_NOT_UTF8: &str = "解密结果不是合法的 UTF-8";
    pub const NOTHING_TO_ENCRYPT: &str = "没有需要加密的内容";
    pub const CIPHERTEXT_MISSING: &str = "缺少密文";
}

/// 局域网同步：本机名称、网络名称。
pub(crate) mod lan {
    /// 读不到 `COMPUTERNAME` 时对外广播的设备名。
    pub const DEFAULT_DEVICE_NAME: &str = "Windows 设备";
    /// 枚举不到网卡、退回路由探测时的网络名。
    pub const DEFAULT_NETWORK_NAME: &str = "本机网络";
}

/// 局域网直连客户端（`lan_http_request`）。
pub(crate) mod lan_http {
    use super::Display;

    /// 单测按「局域网」匹配。
    pub const HTTP_ONLY: &str = "局域网直连只支持 http:// 地址";
    pub const EMPTY_TARGET: &str = "目标地址为空";
    pub const FRAGMENT: &str = "目标地址不能带片段";
    pub const MISSING_HOST: &str = "目标地址缺少主机";
    pub const USERINFO: &str = "目标地址不能带用户名密码";
    pub const IPV4_ONLY: &str = "只支持 IPv4 局域网地址";
    pub const HOST_NOT_IPV4: &str = "目标地址必须是 IPv4";
    pub const NOT_LAN: &str = "局域网直连只接受局域网目标";
    pub const BAD_PORT: &str = "目标端口不合法";

    pub fn unsupported_method(method: impl Display) -> String {
        format!("不支持的请求方法：{method}")
    }

    pub const TOO_MANY_HEADERS: &str = "请求头过多";

    pub fn bad_header_name(name: impl Display) -> String {
        format!("请求头名称不合法：{name}")
    }

    pub fn header_newline(name: impl Display) -> String {
        format!("请求头 {name} 的值不能包含换行")
    }

    pub const HEADERS_TOO_LARGE: &str = "请求头过大";
    pub const CHUNKED_INCOMPLETE: &str = "chunked 响应不完整";
    pub const CHUNK_SIZE_NOT_UTF8: &str = "chunked 长度行不是 UTF-8";
    pub const CHUNK_SIZE_INVALID: &str = "chunked 长度行不合法";
    pub const CHUNKED_NO_END: &str = "chunked 响应缺少结束空行";
    pub const CHUNK_OVERFLOW: &str = "chunked 长度溢出";
    pub const CHUNK_NO_CRLF: &str = "chunked 数据段缺少 CRLF";
    pub const BODY_TOO_LARGE: &str = "响应体超过 20MB 上限";
    pub const HEAD_INCOMPLETE: &str = "响应头不完整";
    pub const HEAD_NOT_UTF8: &str = "响应头不是 UTF-8";
    pub const NOT_HTTP1: &str = "响应不是 HTTP/1.x";
    pub const BAD_STATUS_LINE: &str = "响应状态行不合法";
    pub const BAD_CONTENT_LENGTH: &str = "Content-Length 不合法";
    pub const BODY_INCOMPLETE: &str = "响应体不完整";
    pub const BODY_NOT_UTF8: &str = "响应体不是 UTF-8";
    pub const READ_TIMEOUT: &str = "读取局域网响应超时";

    pub fn read_failed(error: impl Display) -> String {
        format!("读取局域网响应失败：{error}")
    }

    pub fn connect_failed(address: impl Display, error: impl Display) -> String {
        format!("连接 {address} 失败：{error}")
    }

    pub fn read_timeout_setup_failed(error: impl Display) -> String {
        format!("设置读超时失败：{error}")
    }

    pub fn write_timeout_setup_failed(error: impl Display) -> String {
        format!("设置写超时失败：{error}")
    }

    pub fn send_failed(error: impl Display) -> String {
        format!("发送局域网请求失败：{error}")
    }
}

/// 局域网同步服务端：开启失败的原因，以及写给对端、由对端界面展示的错误体。
/// 错误体与 Android `LanSyncServer` 逐字一致。
pub(crate) mod lan_sync {
    use super::Display;

    pub const ADVERTISE_NOT_LAN: &str = "局域网同步只对外展示局域网地址";

    pub fn listen_failed(error: impl Display) -> String {
        format!("监听局域网端口失败：{error}")
    }

    pub fn read_port_failed(error: impl Display) -> String {
        format!("读取监听端口失败：{error}")
    }

    pub fn nonblocking_failed(error: impl Display) -> String {
        format!("设置非阻塞监听失败：{error}")
    }

    pub fn host_not_ipv4(text: impl Display) -> String {
        format!("网络地址不是合法 IPv4：{text}")
    }

    pub const HOST_NOT_LAN: &str = "只能选择局域网地址";
    pub const NO_LAN_ADDRESS: &str = "没有找到局域网地址，请先连接 Wi-Fi 或有线网络";

    pub const BUSY_CONNECTIONS: &str = "连接过多，请稍后重试";
    pub const LAN_ONLY: &str = "只接受同一局域网内的请求";
    pub const TOO_MANY_ATTEMPTS: &str = "配对失败次数过多，请稍后再试";
    pub const METHOD_NOT_ALLOWED: &str = "请求方法不对";
    pub const NOT_FOUND: &str = "没有该接口";
    pub const BUSY_QUEUE: &str = "请求队列已满，请稍后重试";
    pub const HANDLER_TIMEOUT: &str = "本机没有在 10 秒内处理请求";

    pub const BROWSER_ORIGIN: &str = "不接受浏览器网页发起的请求";
    pub const MISSING_HOST: &str = "缺少 Host";
    pub const HOST_NO_PORT: &str = "Host 必须带端口";
    pub const HOST_NOT_IP: &str = "Host 必须是 IP 地址";
    pub const HOST_BAD_PORT: &str = "Host 端口不正确";

    pub const SLOW_REQUEST: &str = "请求发送太慢";
    pub const HEADERS_TOO_LARGE: &str = "请求头过大";
    pub const REQUEST_INCOMPLETE: &str = "请求不完整";

    pub fn read_request_failed(error: impl Display) -> String {
        format!("读取请求失败：{error}")
    }

    pub const HEAD_NOT_UTF8: &str = "请求头不是 UTF-8";
    pub const BODY_INCOMPLETE: &str = "请求体不完整";

    pub fn read_body_failed(error: impl Display) -> String {
        format!("读取请求体失败：{error}")
    }

    pub const BODY_NOT_UTF8: &str = "请求体不是 UTF-8";
    pub const MISSING_METHOD: &str = "缺少请求方法";
    pub const MISSING_PATH: &str = "缺少请求路径";
    pub const NOT_HTTP: &str = "不是 HTTP 请求";
    pub const UNSUPPORTED_METHOD: &str = "不支持的请求方法";
    pub const BAD_PATH: &str = "请求路径不正确";
    pub const BAD_CONTENT_LENGTH: &str = "Content-Length 不正确";
    pub const BODY_TOO_LARGE: &str = "请求体超过 5MB 上限";
}
