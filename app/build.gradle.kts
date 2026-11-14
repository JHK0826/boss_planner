import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.google.services)
}

// 버전은 저장소 최상위의 version.properties 한 곳에서 관리한다.
val appVersion = Properties().apply { rootProject.file("version.properties").inputStream().use(::load) }
val appVersionName: String = appVersion.getProperty("versionName")
val appVersionCode: Int = appVersion.getProperty("versionCode").toInt()

// APK 파일 이름에 버전을 넣는다: boss-planner-0.1.0-debug.apk
base {
    archivesName.set("boss-planner-$appVersionName")
}

// 릴리스 서명 키. 저장소에는 없고, GitHub Actions가 비밀 값에서 꺼내 환경 변수로 넘긴다.
// 같은 키로 서명해야 새 버전이 기존 앱 위에 덮어 설치된다.
val releaseKeystore: String? = System.getenv("KEYSTORE_FILE")?.takeIf { it.isNotBlank() }

android {
    namespace = "com.bossplanner.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.bossplanner.app"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")?.takeIf { it.isNotBlank() } ?: "bossplanner"
                // 따로 정하지 않았으면 키 비밀번호는 키 저장소 비밀번호와 같다.
                keyPassword = System.getenv("KEY_PASSWORD")?.takeIf { it.isNotBlank() } ?: System.getenv("KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // 서명 키가 없으면(로컬 빌드) 서명되지 않은 APK가 나온다. 로컬에서는 debug 빌드를 쓴다.
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    debugImplementation(libs.compose.ui.tooling)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.firebase.firestore)
    implementation(libs.firebase.functions)
    implementation(libs.firebase.messaging)
    implementation(libs.firebase.storage)
    implementation(libs.coroutines.play.services)

    implementation(libs.coil.compose)

    testImplementation(libs.junit)
}
