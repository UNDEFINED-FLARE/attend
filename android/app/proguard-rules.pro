# R8 rules for the UniAttend release build (minifyEnabled in app/build.gradle).
# Capacitor and its plugins ship their own keep rules (consumer rules); these are the
# extra safety net for what is only reached by reflection or from JavaScript.

# Capacitor reads @CapacitorPlugin / @PluginMethod at runtime, so annotations must survive.
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod

# The WebView <-> native bridge: methods JavaScript calls by name.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Every Capacitor plugin class and its callable methods (local notifications, biometric unlock).
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep class com.getcapacitor.** { *; }

# Readable stack traces in Play Console crash reports (upload the mapping file with each release).
-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile
