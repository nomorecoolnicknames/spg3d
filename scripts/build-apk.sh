#!/usr/bin/env bash
# Builds the web bundle, syncs it into the Capacitor Android project and produces a signed release APK.
# Output: release/spg3d-<version>-release.apk (+ sha256). Gradle output goes to /mnt/ramdisk/spg3d-android.
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME=/home/n8n/android-sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
VERSION=$(node -p "require('./package.json').version")
npx vite build
npx cap sync android
( cd android && ./gradlew assembleRelease -q --no-daemon --console=plain )
mkdir -p release
APK=/mnt/ramdisk/spg3d-android/app/outputs/apk/release/app-release.apk
cp "$APK" "release/spg3d-${VERSION}-release.apk"
ls -la "release/spg3d-${VERSION}-release.apk"
sha256sum "release/spg3d-${VERSION}-release.apk"
