package com.dawntick.app.school

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

/** 应用内教务窗口：用户自行登录并打开课表页，页面右下角的「导入到晓刻」把内容交回 Web 层。 */
class SchoolWebActivity : AppCompatActivity() {
    private lateinit var webView: WebView

    /** 最近一次由注入脚本交回的内容，取消时为空串。 */
    @Volatile
    private var payload: String = ""

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = "登录教务并打开课表页"
        val url = intent.getStringExtra("url").orEmpty()
        if (url.isEmpty()) {
            finish()
            return
        }

        webView = WebView(this)
        webView.setBackgroundColor(Color.WHITE)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = true
            displayZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        webView.addJavascriptInterface(Bridge(), "DawnTickImport")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // 非 http/https（自定义 scheme、intent:// 等）一律不加载。
                val target = request.url
                val scheme = target.scheme?.lowercase()
                if (scheme != "http" && scheme != "https") return true
                return false
            }

            override fun onPageFinished(view: WebView, loadedUrl: String?) {
                // 注入脚本自带 window.__dtImportReady 守卫，重复注入不会叠加按钮。
                view.evaluateJavascript(INJECTION, null)
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(
                view: WebView,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: android.os.Message,
            ): Boolean {
                // 教务菜单多用 window.open/target=_blank 打开子页面，默认会被静默拒绝。
                // 改为在当前 WebView 内跳转，登录会话与「导入到晓刻」按钮都保留。
                val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
                val child = transport.webView ?: return false
                child.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(
                        childView: WebView,
                        request: WebResourceRequest,
                    ): Boolean {
                        val scheme = request.url.scheme?.lowercase()
                        if (scheme != "http" && scheme != "https") return true
                        val target = request.url.toString()
                        view.post { view.loadUrl(target) }
                        return true
                    }
                }
                return false
            }
        }
        setContentView(webView)
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    // 先回退网页历史，退到底再关闭窗口。
                    if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        finish()
                    }
                }
            },
        )
        webView.loadUrl(url)
    }

    /** 注入脚本交回内容的 JS 接口。 */
    private inner class Bridge {
        @JavascriptInterface
        fun submit(payload: String) {
            runOnUiThread { finishWith(payload) }
        }
    }

    private fun finishWith(value: String) {
        payload = value
        setResult(Activity.RESULT_OK, Intent().putExtra("payload", value))
        finish()
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.removeJavascriptInterface("DawnTickImport")
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }

    companion object {
        /**
         * 注入到教务页面的脚本：右下角「导入到晓刻」按钮。
         * 采集规则与桌面端 apps/desktop/src-tauri/src/import-injection.js 的 collect() 保持一致
         * （documentElement.outerHTML、同源 iframe 递归到深度 2、去重、最大 1.5 MB）。
         * 内容通过 DawnTickImport.submit() 交回；接口不存在或内容过大时显示手动复制面板。
         * 原样拼接成 JavaScript 源码，不做任何转义。
         */
        private const val INJECTION: String = """(function () {
  if (window.__dtImportReady) {
    return;
  }
  window.__dtImportReady = true;

  var MAX_PAYLOAD = 1500000;

  var collect = function () {
    var parts = [];
    var seen = new Set();
    var walk = function (doc, depth) {
      if (!doc || depth > 2 || seen.has(doc)) {
        return;
      }
      seen.add(doc);
      try {
        parts.push(doc.documentElement.outerHTML);
      } catch (error) {}
      var frames = [];
      try {
        frames = Array.prototype.slice.call(doc.querySelectorAll('iframe,frame'));
      } catch (error) {}
      frames.forEach(function (frame) {
        try {
          walk(frame.contentDocument, depth + 1);
        } catch (error) {}
      });
    };
    walk(document, 0);
    var info = { v: 2, url: location.href, title: document.title, frames: parts.length };
    return '<<<DAWNTICK>>>' + JSON.stringify(info) + '<<<FRAME>>>' + parts.join('<<<FRAME>>>') + '<<<END>>>';
  };

  var showFallback = function (payload) {
    var previous = document.getElementById('dt-import-fallback');
    if (previous) {
      previous.remove();
    }
    var panel = document.createElement('div');
    panel.id = 'dt-import-fallback';
    panel.style.cssText =
      'position:fixed;right:18px;bottom:78px;z-index:2147483647;width:320px;max-width:80vw;padding:12px;border-radius:12px;background:#fff;color:#141414;box-shadow:0 6px 24px rgba(0,0,0,.35);font-size:13px;line-height:1.5';
    var title = document.createElement('div');
    title.textContent = '页面太大或带不过来，请全选下面的内容复制，回到晓刻粘贴导入';
    var box = document.createElement('textarea');
    box.value = payload;
    box.style.cssText = 'width:100%;height:120px;margin-top:8px;font-size:11px';
    box.onclick = function () {
      box.select();
    };
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = '关闭';
    close.style.cssText = 'margin-top:8px;padding:6px 12px;border:1px solid #ccc;border-radius:8px;background:#f5f5f5;cursor:pointer';
    close.onclick = function () {
      panel.remove();
    };
    panel.appendChild(title);
    panel.appendChild(box);
    panel.appendChild(close);
    document.body.appendChild(panel);
  };

  var mount = function () {
    if (!document.body || document.getElementById('dt-import-button')) {
      return;
    }
    var button = document.createElement('button');
    button.id = 'dt-import-button';
    button.type = 'button';
    button.textContent = '导入到晓刻';
    button.style.cssText =
      'position:fixed;right:18px;bottom:18px;z-index:2147483647;padding:12px 20px;border:0;border-radius:999px;background:#ff6b4a;color:#141414;font-size:15px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer';
    button.onclick = function () {
      button.textContent = '正在读取课表…';
      var payload;
      try {
        payload = collect();
      } catch (error) {
        button.textContent = '读取失败，请重试';
        return;
      }
      var bridge = window.DawnTickImport;
      if (!bridge || typeof bridge.submit !== 'function' || payload.length > MAX_PAYLOAD) {
        showFallback(payload);
        button.textContent = '请手动复制';
        return;
      }
      try {
        bridge.submit(payload);
        button.textContent = '已交给晓刻';
      } catch (error) {
        showFallback(payload);
        button.textContent = '请手动复制';
      }
    };
    document.body.appendChild(button);
  };

  // 教务菜单用 window.open 打开子页面，默认会被 WebView 拒绝且没有任何提示。
  // 改为在当前窗口内跳转：登录会话与「导入到晓刻」按钮都保留。
  try {
    var nativeOpen = window.open;
    window.open = function (targetUrl) {
      if (typeof targetUrl === 'string' && /^https?:\/\//i.test(targetUrl)) {
        window.location.href = targetUrl;
        return window;
      }
      if (typeof nativeOpen === 'function') {
        return nativeOpen.apply(window, arguments);
      }
      return null;
    };
  } catch (error) {}

  if (document.readyState === 'loading' && !document.body) {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();"""
    }
}
