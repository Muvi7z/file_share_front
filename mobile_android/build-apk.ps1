Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Push-Location $PSScriptRoot
try {
    $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
    $env:ANDROID_HOME = "C:\Users\Ochir\AppData\Local\Android\Sdk"
    $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME

    if (Test-Path ".\gradlew.bat") {
        .\gradlew.bat assembleDebug
        exit $LASTEXITCODE
    }

    if (Test-Path ".\.gradle-local\gradle-8.10.2\bin\gradle.bat") {
        .\.gradle-local\gradle-8.10.2\bin\gradle.bat assembleDebug
        exit $LASTEXITCODE
    }

    $gradle = Get-Command gradle -ErrorAction SilentlyContinue
    if ($null -eq $gradle) {
        Write-Host "Gradle is not installed. Install Gradle or keep .gradle-local\gradle-8.10.2 in this folder."
        exit 1
    }

    gradle wrapper
    .\gradlew.bat assembleDebug
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
