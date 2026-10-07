pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
        // Only androidx.sqlite (the Android adapter) lives on Google Maven.
        google {
            content { includeGroupByRegex("androidx\\..*") }
        }
    }
}

rootProject.name = "spdf-kotlin"

include(":spdf-core", ":spdf", ":spdf-android")
