plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.maven.publish)
}

description = "SPDF (Semantic Processed Document Format) for Kotlin and Java: the SQLite-independent core " +
    "(canonical dump, validation, search, anchors, citation, export, writer)."

dependencies {
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(kotlin("test-junit5"))
    testRuntimeOnly(libs.junit.launcher)
}
