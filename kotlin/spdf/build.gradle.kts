plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.maven.publish)
    application
}

description = "SPDF (Semantic Processed Document Format) for the JVM: the core plus a SQLite adapter over " +
    "org.xerial:sqlite-jdbc, and the spdf command-line tool."

dependencies {
    api(project(":spdf-core"))
    implementation(libs.sqlite.jdbc)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(kotlin("test-junit5"))
    testRuntimeOnly(libs.junit.launcher)
}

application {
    mainClass.set("io.github.joseluissaorin.spdf.cli.Main")
    applicationName = "spdf"
}

// `./gradlew :spdf:run --args="…"` resolves relative paths from the kotlin/ folder.
tasks.named<JavaExec>("run") {
    workingDir = rootProject.projectDir
}

// `./gradlew :spdf:conformance` runs the whole suite and writes build/conformance.json.
val conformanceDir: String = System.getenv("SPDF_CONFORMANCE_DIR")
    ?: rootProject.layout.projectDirectory.dir("../conformance").asFile.absolutePath

tasks.register<JavaExec>("conformance") {
    group = "verification"
    description = "Runs the SPDF conformance suite and writes build/conformance.json."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("io.github.joseluissaorin.spdf.cli.Main")
    val out = rootProject.layout.buildDirectory.file("conformance.json")
    args("conformance", conformanceDir, "-o", out.get().asFile.absolutePath)
    outputs.upToDateWhen { false }
}
