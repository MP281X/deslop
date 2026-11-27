#!/bin/sh
set -eu

app=ios/App/App
project=ios/App/App.xcodeproj/project.pbxproj

# Keep the stock Capacitor project; wire the shared Keychain/RPC bridge and app artwork into its target.
sed -i '' 's/customClass="CAPBridgeViewController" customModule="Capacitor"/customClass="DeslopViewController" customModule="App" customModuleProvider="target"/' "$app/Base.lproj/Main.storyboard"
cat >> "$app/AppDelegate.swift" <<'SWIFT'

final class DeslopViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(DeslopNativePlugin())
    }
}
SWIFT

cat > "$app/App.entitlements" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.developer.associated-domains</key>
    <array><string>webcredentials:$(DESLOP_AUTH_HOST)</string></array>
    <key>keychain-access-groups</key>
    <array><string>$(DESLOP_KEYCHAIN_GROUP)</string></array>
</dict>
</plist>
PLIST

/usr/libexec/PlistBuddy \
	-c 'Add :DeslopServer string $(DESLOP_SERVER)' \
	-c 'Add :DeslopAuth string $(DESLOP_AUTH)' \
	-c 'Add :DeslopSlug string template-app' \
	-c 'Add :DeslopKeychainGroup string $(DESLOP_KEYCHAIN_GROUP)' \
	-c 'Add :UIUserInterfaceStyle string Dark' \
	-c 'Add :ITSAppUsesNonExemptEncryption bool false' \
	"$app/Info.plist"

cat > ios/App/Config.xcconfig <<'XCCONFIG'
DESLOP_DOMAIN = mp281x.xyz
DESLOP_SLUG = template-app
DESLOP_SERVER = https:/$()/$(DESLOP_SLUG).$(DESLOP_DOMAIN)
DESLOP_AUTH_HOST = auth.$(DESLOP_DOMAIN)
DESLOP_AUTH = https:/$()/$(DESLOP_AUTH_HOST)
XCCONFIG
printf '\n#include "App/Config.xcconfig"\n' >> ios/debug.xcconfig

sed -i '' \
	-e '/Begin PBXBuildFile section/a\
		D35000000000000000000001 = {isa = PBXBuildFile; fileRef = D35000000000000000000002; };\
		D35000000000000000000003 = {isa = PBXBuildFile; fileRef = D35000000000000000000004; };
' \
	-e '/Begin PBXFileReference section/a\
		D35000000000000000000002 = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ../../../../packages/ui/native/DeslopNative.swift; sourceTree = SOURCE_ROOT; };\
		D35000000000000000000004 = {isa = PBXFileReference; lastKnownFileType = folder.iconcomposer.icon; path = ../../src/web/app.icon; sourceTree = SOURCE_ROOT; };\
		D35000000000000000000005 /* Config.xcconfig */ = {isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = Config.xcconfig; sourceTree = SOURCE_ROOT; };
' \
	-e '/debug\.xcconfig \*\/,$/a\
				D35000000000000000000005 /* Config.xcconfig */,
' \
	-e '/504EC3151FED79650016851F \/\* Release \*\/ = {/ {' \
	-e 'n' \
	-e 'a\
			baseConfigurationReference = D35000000000000000000005 /* Config.xcconfig */;
' -e '}' \
	-e 's/^\([[:space:]]*\)\(.*AppDelegate.swift in Sources \*\/,$\)/\1D35000000000000000000001,\
\1\2/' \
	-e 's/^\([[:space:]]*\)\(.*Assets.xcassets in Resources \*\/,$\)/\1D35000000000000000000003,\
\1\2/' \
	-e 's/IPHONEOS_DEPLOYMENT_TARGET = 15.0;/IPHONEOS_DEPLOYMENT_TARGET = 26.0;/' \
	-e 's/ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/ASSETCATALOG_COMPILER_APPICON_NAME = app;/' \
	-e '/ASSETCATALOG_COMPILER_APPICON_NAME/a\
				CODE_SIGN_ENTITLEMENTS = App/App.entitlements;\
				DESLOP_KEYCHAIN_GROUP = "$(DEVELOPMENT_TEAM).group.$(PRODUCT_BUNDLE_IDENTIFIER)";
' \
	"$project"
