; ─── PianKe 安装程序：安装路径 + 桌面快捷方式 ───
!include LogicLib.nsh
!include nsDialogs.nsh
!include WinMessages.nsh

Var CheckboxDesktop
Var DirRequest
Var FontTitle
Var FontSection
Var FontBody
Var FontHint

Page custom InstallPathPageShow InstallPathPageLeave

Function InstallPathPageShow
  nsDialogs::Create 1018
  Pop $0

  ; 字体
  CreateFont $FontTitle "Microsoft YaHei UI" "18" "600"
  CreateFont $FontSection "Microsoft YaHei UI" "10" "600"
  CreateFont $FontBody "Microsoft YaHei UI" "9" "400"
  CreateFont $FontHint "Microsoft YaHei UI" "8" "400"

  ; ── 应用名称 ──
  ${NSD_CreateLabel} 0 6u 100% 24u "${PRODUCT_NAME}"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontTitle 1

  ; ── 副标题 ──
  ${NSD_CreateLabel} 0 30u 100% 12u "个人影视日记 · 版本 ${VERSION}"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontHint 1

  ; ── 分隔线 ──
  ${NSD_CreateLabel} 0 48u 100% 1u ""
  Pop $0
  SetCtlColors $0 0xe0e0e0 0xe0e0e0

  ; ── 安装路径 ──
  ${NSD_CreateLabel} 0 58u 100% 12u "安装路径"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontSection 1

  ; $INSTDIR 在更新安装时由 electron-updater 传入现有安装目录；
  ; 首次安装时则由 NSIS 的 per-user 默认目录初始化。
  ${NSD_CreateDirRequest} 0 72u 78% 14u "$INSTDIR"
  Pop $DirRequest
  SendMessage $DirRequest ${WM_SETFONT} $FontBody 1
  SetCtlColors $DirRequest 0x333333 0xf5f5f5

  ${NSD_CreateBrowseButton} 79% 72u 21% 14u "浏览..."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontBody 1
  ${NSD_OnClick} $0 OnBrowseButton

  ; ── 空间提示 ──
  ${NSD_CreateLabel} 0 89u 100% 10u "所需空间: 约 180 MB"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontHint 1

  ; ── 选项 ──
  ${NSD_CreateLabel} 0 108u 100% 12u "选项"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $FontSection 1

  ${NSD_CreateCheckbox} 0 122u 100% 12u "创建桌面快捷方式(&D)"
  Pop $CheckboxDesktop
  SendMessage $CheckboxDesktop ${WM_SETFONT} $FontBody 1
  ${NSD_SetState} $CheckboxDesktop ${BST_CHECKED}

  nsDialogs::Show
FunctionEnd

Function OnBrowseButton
  ${NSD_GetText} $DirRequest $0
  nsDialogs::SelectFolderDialog "选择 PianKe 安装路径" $0
  Pop $0
  ${If} $0 != "error"
    ${NSD_SetText} $DirRequest $0
  ${EndIf}
FunctionEnd

Function InstallPathPageLeave
  ${NSD_GetText} $DirRequest $INSTDIR
FunctionEnd

; ─── 安装阶段 ───
!macro customInstall
  ${If} $CheckboxDesktop == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\PianKe.lnk" "$INSTDIR\PianKe.exe"
  ${EndIf}
!macroend

; ─── 卸载阶段 ───
!macro customUnInstall
  Delete "$DESKTOP\PianKe.lnk"
!macroend
