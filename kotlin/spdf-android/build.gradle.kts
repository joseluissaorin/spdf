plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.maven.publish)
}

description = "SPDF (Semantic Processed Document Format) for Android: the core plus a SQLite adapter over the " +
    "androidx.sqlite driver API with the bundled SQLite (FTS5 and trigram included)."

// A plain JVM library on purpose: it compiles and is tested on the host JVM (the bundled
// driver ships desktop natives too), needs no Android SDK, and Android apps consume it
// like any other jar (Gradle picks the Android variant of androidx.sqlite for them).
dependencies {
    api(project(":spdf-core"))
    api(libs.androidx.sqlite)
    api(libs.androidx.sqlite.bundled)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(kotlin("test-junit5"))
    testRuntimeOnly(libs.junit.launcher)
}
