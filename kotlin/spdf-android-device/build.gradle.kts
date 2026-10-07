// Test-only module: runs the SPDF conformance suite on an Android device or emulator through
// the androidx.sqlite adapter. Included only with -Pspdf.androidDevice=true (see
// settings.gradle.kts); never published.
plugins {
    id("com.android.library") version "9.4.1"
}

android {
    namespace = "io.github.joseluissaorin.spdf.device"
    compileSdk = 36
    defaultConfig {
        minSdk = 23
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets {
        // The whole suite travels inside the test APK as assets.
        getByName("androidTest").assets.directories.add(
            System.getenv("SPDF_CONFORMANCE_DIR") ?: rootProject.layout.projectDirectory.dir("../conformance").asFile.path,
        )
    }
    packaging {
        resources.excludes += setOf("META-INF/LICENSE*", "META-INF/NOTICE*", "META-INF/*.kotlin_module")
    }
}

dependencies {
    androidTestImplementation(project(":spdf-android"))
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("junit:junit:4.13.2")
}
