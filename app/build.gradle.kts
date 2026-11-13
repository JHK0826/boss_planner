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

// APK 파일 이름에 버전을 넣는다: boss-planner-1.0.0-debug.apk
base {
    archivesName.set("boss-planner-$appVersionName")
}

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

    buildTypes {
        release {
            isMinifyEnabled = false
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
    debugImplementation(libs.compose.ui.tooling)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.firebase.firestore)
    implementation(libs.firebase.functions)
    implementation(libs.firebase.messaging)
    implementation(libs.coroutines.play.services)

    implementation(libs.coil.compose)
}
