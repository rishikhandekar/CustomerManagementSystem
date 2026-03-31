[Setup]
; Your Unique App ID (The double bracket at the start is required by Inno Setup)
AppId={{D6626C92-FF88-4978-8A6D-4263F03EC897}

; Basic App Info
AppName=Customer Management System
AppVersion=1.0.0
AppPublisher=Rishi Khandekar
AppCopyright=Copyright (C) 2026 Rishi Khandekar

; Installation Rules
DefaultDirName={autopf}\CustomerManagementSystem
DisableProgramGroupPage=yes

; Installer Looks & Output
SetupIconFile=CMS.ico
OutputDir=.\
OutputBaseFilename=CMS_Setup_v1.0.0
UninstallDisplayIcon={app}\CustomerManagementSystem.exe
WizardStyle=modern

DisableWelcomePage=no

; Professional Upgrades (License & Branding)
LicenseFile=License.txt
WizardImageFile=CMS_installer_banner.bmp
WizardSmallImageFile=CMS_installer_logo.bmp

; Compression (Small download size)
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=admin

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Grabs your entire compiled PyInstaller folder
Source: "dist\CustomerManagementSystem\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Creates the Start Menu and Desktop shortcuts
Name: "{autoprograms}\CMS"; Filename: "{app}\CustomerManagementSystem.exe"; Comment: "Customer Management System"
Name: "{autodesktop}\CMS"; Filename: "{app}\CustomerManagementSystem.exe"; Tasks: desktopicon; Comment: "Customer Management System"

[Run]
; Launch checkbox at the end
Filename: "{app}\CustomerManagementSystem.exe"; Description: "{cm:LaunchProgram,Customer Management System}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Cleans everything perfectly if uninstalled
Type: filesandordirs; Name: "{app}"