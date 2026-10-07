pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        // Only the Android Gradle Plugin (on-device test module) lives on Google Maven.
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx\\..*")
            }
        }
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
        // androidx.sqlite (the Android adapter), and AGP's own tools for the on-device tests.
        google {
            content {
                includeGroupByRegex("androidx\\..*")
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
            }
        }
    }
}

rootProject.name = "spdf-kotlin"

include(":spdf-core", ":spdf", ":spdf-android")

// On-device tests of the Android adapter (an AGP module). Off by default so that builds
// without an Android SDK, or without an emulator, never see it:
//   ./gradlew -Pspdf.androidDevice=true :spdf-android-device:connectedAndroidTest
val androidDevice = providers.gradleProperty("spdf.androidDevice").orNull == "true" ||
    providers.environmentVariable("SPDF_ANDROID_DEVICE").orNull == "true"
if (androidDevice) include(":spdf-android-device")
