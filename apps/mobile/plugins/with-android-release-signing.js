const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SIGNING_BLOCK = `def releaseKeystorePropertiesFile = rootProject.file("app/keystore.properties")
def releaseKeystoreProperties = new Properties()
def releaseKeystorePropertiesLoaded = false

if (releaseKeystorePropertiesFile.exists()) {
    releaseKeystorePropertiesFile.withInputStream { stream ->
        releaseKeystoreProperties.load(stream)
    }
    releaseKeystorePropertiesLoaded = true
}

def readReleaseSigningValue = { String propertyKey, String envKey ->
    def envValue = System.getenv(envKey)
    if (envValue != null && !envValue.trim().isEmpty()) {
        return envValue.trim()
    }

    if (!releaseKeystorePropertiesLoaded) {
        return null
    }

    def propertyValue = releaseKeystoreProperties.getProperty(propertyKey)
    if (propertyValue == null) {
        return null
    }

    def trimmedValue = propertyValue.trim()
    return trimmedValue.isEmpty() ? null : trimmedValue
}

def releaseStoreFileValue = readReleaseSigningValue("storeFile", "CLAWKET_ANDROID_KEYSTORE_PATH")
def releaseStorePasswordValue = readReleaseSigningValue("storePassword", "CLAWKET_ANDROID_KEYSTORE_PASSWORD")
def releaseKeyAliasValue = readReleaseSigningValue("keyAlias", "CLAWKET_ANDROID_KEY_ALIAS")
def releaseKeyPasswordValue = readReleaseSigningValue("keyPassword", "CLAWKET_ANDROID_KEY_PASSWORD")
def hasReleaseSigningConfig = releaseStoreFileValue && releaseStorePasswordValue && releaseKeyAliasValue && releaseKeyPasswordValue
def allowDebugReleaseSigning = (findProperty("clawket.allowDebugReleaseSigning") ?: System.getenv("CLAWKET_ALLOW_DEBUG_RELEASE_SIGNING") ?: "false").toString().toBoolean()

gradle.taskGraph.whenReady { graph ->
    def releaseTaskRequested = graph.allTasks.any { task ->
        task.name?.toLowerCase()?.contains("release") || task.name?.toLowerCase()?.contains("bundle")
    }

    if (releaseTaskRequested && !hasReleaseSigningConfig && !allowDebugReleaseSigning) {
        throw new GradleException(
            "Missing Android release signing config. " +
            "Provide CLAWKET_ANDROID_KEYSTORE_PATH / CLAWKET_ANDROID_KEYSTORE_PASSWORD / " +
            "CLAWKET_ANDROID_KEY_ALIAS / CLAWKET_ANDROID_KEY_PASSWORD, or create android/app/keystore.properties. " +
            "For temporary local-only testing, rerun with -Pclawket.allowDebugReleaseSigning=true."
        )
    }
}
`;

const SIGNING_CONFIG_BLOCK = `        if (hasReleaseSigningConfig) {
            release {
                storeFile file(releaseStoreFileValue)
                storePassword releaseStorePasswordValue
                keyAlias releaseKeyAliasValue
                keyPassword releaseKeyPasswordValue
            }
        }`;

const RELEASE_SIGNING_BRANCH = `            if (hasReleaseSigningConfig) {
                signingConfig signingConfigs.release
            } else {
                signingConfig signingConfigs.debug
            }`;
const DEBUG_SIGNING_LINE = `            signingConfig signingConfigs.debug`;
const MISAPPLIED_BUILD_TYPES_BLOCK = `    buildTypes {
        debug {
            if (hasReleaseSigningConfig) {
                signingConfig signingConfigs.release
            } else {
                signingConfig signingConfigs.debug
            }
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            if (hasReleaseSigningConfig) {
                signingConfig signingConfigs.release
            } else {
                signingConfig signingConfigs.debug
            }`;

const CORRECT_BUILD_TYPES_BLOCK = `    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            if (hasReleaseSigningConfig) {
                signingConfig signingConfigs.release
            } else {
                signingConfig signingConfigs.debug
            }`;

const KEYSTORE_PROPERTIES_EXAMPLE = `storeFile=/absolute/path/to/clawket-upload.keystore
storePassword=replace-me
keyAlias=upload
keyPassword=replace-me
`;

function normalizeDebugBuildType(src) {
  return src.replace(
    `    buildTypes {
        debug {
            if (hasReleaseSigningConfig) {
                signingConfig signingConfigs.release
            } else {
                signingConfig signingConfigs.debug
            }
        }
        release {`,
    `    buildTypes {
        debug {
${DEBUG_SIGNING_LINE}
        }
        release {`,
  );
}

function replaceReleaseSigningConfig(src) {
  return src.replace(
    /(        release \{\n(?:.*\n)*?)(            signingConfig signingConfigs\.debug)/,
    (_, prefix) => `${prefix}${RELEASE_SIGNING_BRANCH}`,
  );
}

function applyReleaseSigningToGradle(src) {
  let next = src;

  next = next.replace(MISAPPLIED_BUILD_TYPES_BLOCK, CORRECT_BUILD_TYPES_BLOCK);

  if (!next.includes('def releaseKeystorePropertiesFile = rootProject.file("app/keystore.properties")')) {
    next = next.replace(
      'def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()',
      `def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()\n${SIGNING_BLOCK}`,
    );
  }

  if (!next.includes('if (hasReleaseSigningConfig) {\n            release {')) {
    next = next.replace(
      `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }`,
      `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
${SIGNING_CONFIG_BLOCK}`,
    );
  }

  next = normalizeDebugBuildType(next);
  next = replaceReleaseSigningConfig(next);

  return next;
}

function withAndroidReleaseSigning(config) {
  config = withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withAndroidReleaseSigning only supports Groovy build.gradle files.');
    }

    cfg.modResults.contents = applyReleaseSigningToGradle(cfg.modResults.contents);
    return cfg;
  });

  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const targetPath = path.join(cfg.modRequest.projectRoot, 'android-keystore.properties.example');
      if (!fs.existsSync(targetPath)) {
        fs.writeFileSync(targetPath, KEYSTORE_PROPERTIES_EXAMPLE);
      }

      return cfg;
    },
  ]);
}

module.exports = withAndroidReleaseSigning;
