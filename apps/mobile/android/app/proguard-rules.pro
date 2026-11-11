
# Capacitor / 插件：桥按类名反射注册，R8 不能删/改名
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep class com.dawntick.app.** { *; }
-keepclassmembers class * { @com.getcapacitor.PluginMethod public *; }
-keepattributes *Annotation*
-dontwarn org.apache.**
# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
