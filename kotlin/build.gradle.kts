import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinJvmProjectExtension
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion

plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.maven.publish) apply false
}

allprojects {
    group = providers.gradleProperty("GROUP").get()
    version = providers.gradleProperty("VERSION_NAME").get()
}

// Every module targets Java 17 bytecode (also fine for Android's D8), whatever JDK
// (17 or newer) runs Gradle. No toolchain download is ever needed.
subprojects {
    plugins.withId("org.jetbrains.kotlin.jvm") {
        extensions.configure<KotlinJvmProjectExtension> {
            explicitApi()
            compilerOptions {
                jvmTarget.set(JvmTarget.JVM_17)
                freeCompilerArgs.add("-Xjdk-release=17")
                // Consumers on older Kotlin compilers (common in Android apps) can read our
                // metadata, and we only use the standard library of that version.
                languageVersion.set(KotlinVersion.KOTLIN_2_2)
                apiVersion.set(KotlinVersion.KOTLIN_2_2)
            }
            coreLibrariesVersion = "2.2.21"
        }
        extensions.configure<JavaPluginExtension> {
            sourceCompatibility = JavaVersion.VERSION_17
            targetCompatibility = JavaVersion.VERSION_17
        }
        tasks.withType<JavaCompile>().configureEach {
            options.release.set(17)
            options.encoding = "UTF-8"
        }
        tasks.withType<Test>().configureEach {
            useJUnitPlatform()
            // The conformance suite lives next to this folder; CI may point elsewhere.
            val dir = System.getenv("SPDF_CONFORMANCE_DIR")
                ?: rootProject.layout.projectDirectory.dir("../conformance").asFile.absolutePath
            systemProperty("spdf.conformance.dir", dir)
            inputs.dir(dir).withPropertyName("conformanceSuite").optional()
            testLogging {
                events("failed")
                showStandardStreams = false
                exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
            }
        }
    }
    plugins.withId("com.vanniktech.maven.publish") {
        // A repository inside build/ to inspect exactly what would be uploaded:
        // ./gradlew publishAllPublicationsToBuildRepoRepository
        extensions.configure<PublishingExtension> {
            repositories {
                maven {
                    name = "buildRepo"
                    url = uri(rootProject.layout.buildDirectory.dir("repo"))
                }
            }
        }
        extensions.configure<com.vanniktech.maven.publish.MavenPublishBaseExtension> {
            publishToMavenCentral()
            // Sign only when a key is configured (Central needs it; local builds do not).
            if (providers.gradleProperty("signingInMemoryKey").isPresent ||
                providers.gradleProperty("signing.keyId").isPresent
            ) {
                signAllPublications()
            }
            pom {
                name.set(project.name)
                description.set(project.description)
                inceptionYear.set("2026")
                url.set("https://github.com/joseluissaorin/spdf")
                licenses {
                    license {
                        name.set("MIT")
                        url.set("https://opensource.org/license/mit")
                        distribution.set("repo")
                    }
                    license {
                        name.set("Apache-2.0")
                        url.set("https://www.apache.org/licenses/LICENSE-2.0")
                        distribution.set("repo")
                    }
                }
                developers {
                    developer {
                        id.set("joseluissaorin")
                        name.set("José Luis Saorín Ferrer")
                        url.set("https://joseluissaorin.com")
                    }
                }
                scm {
                    url.set("https://github.com/joseluissaorin/spdf")
                    connection.set("scm:git:https://github.com/joseluissaorin/spdf.git")
                    developerConnection.set("scm:git:ssh://git@github.com/joseluissaorin/spdf.git")
                }
            }
        }
    }
}
