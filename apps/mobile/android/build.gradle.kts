allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    // Register before evaluationDependsOn. That call evaluates :app (and the
    // plugins it depends on) immediately; an afterEvaluate added in a later
    // subprojects block arrives after those projects are already evaluated.
    //
    // file_picker 8.x hardcodes compileSdk 34. Flutter 3.47 plugins such as
    // flutter_plugin_android_lifecycle use compileSdk 36, and AGP refuses an
    // AAR whose min compile SDK is higher (checkReleaseAarMetadata). The app
    // already uses flutter.compileSdkVersion (36). compileSdk is not targetSdk.
    afterEvaluate {
        val android = extensions.findByName("android") ?: return@afterEvaluate
        if (android !is com.android.build.gradle.BaseExtension) return@afterEvaluate
        val current = android.compileSdkVersion
            ?.removePrefix("android-")
            ?.substringBefore(".")
            ?.toIntOrNull()
        if (current != null && current < 36) {
            android.compileSdkVersion(36)
        }
    }
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
