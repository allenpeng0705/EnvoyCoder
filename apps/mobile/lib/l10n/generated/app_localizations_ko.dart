// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Korean (`ko`).
class AppLocalizationsKo extends AppLocalizations {
  AppLocalizationsKo([String locale = 'ko']) : super(locale);

  @override
  String get appName => 'EnvoyDev';

  @override
  String get commonAdd => '추가';

  @override
  String get commonCancel => '취소';

  @override
  String get commonClear => '지우기';

  @override
  String get commonConfirm => '확인';

  @override
  String get commonContinue => '계속';

  @override
  String get commonNone => '없음';

  @override
  String get commonNotSet => '설정되지 않음';

  @override
  String get commonOk => '확인';

  @override
  String get commonRemove => '제거';

  @override
  String get commonRename => '이름 바꾸기';

  @override
  String get commonSave => '저장';

  @override
  String get commonSaving => '저장 중…';

  @override
  String get connectionStateConnected => '연결됨';

  @override
  String get connectionStateConnecting => '연결 중';

  @override
  String get connectionStateReconnecting => '다시 연결 중 — 작업은 계속 실행됩니다';

  @override
  String get connectionStateFailed => '연결할 수 없음';

  @override
  String get connectionStateIdle => '아직 연결되지 않음';

  @override
  String get connectionsTitle => '연결';

  @override
  String connectionsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '컴퓨터 $count대',
      one: '컴퓨터 1대',
    );
    return '$_temp0';
  }

  @override
  String get connectionsAddHost => '호스트 추가';

  @override
  String get connectionsAddHostSubtitle => '코드를 스캔하거나 주소를 입력하세요';

  @override
  String get connectionsEmpty => '아직 페어링된 컴퓨터가 없습니다.';

  @override
  String connectionsCurrent(String name) {
    return '$name · 현재';
  }

  @override
  String connectionsRowDetail(String endpoint, String state) {
    return '$endpoint · $state';
  }

  @override
  String connectionsRowDetailVia(String endpoint, String state, String route) {
    return '$endpoint · $state · $route 경유';
  }

  @override
  String get connectionsRenameTitle => '연결 이름 바꾸기';

  @override
  String get connectionsRenameField => '연결 이름';

  @override
  String get connectionsRenameEmpty => '이 연결의 이름을 입력하세요.';

  @override
  String connectionsForgetTitle(String name) {
    return '$name을(를) 잊을까요?';
  }

  @override
  String get connectionsForgetMessage =>
      '이 휴대폰은 그 컴퓨터에 더 이상 연결하지 않고 페어링을 잊습니다. 그곳에서 이미 실행 중인 작업은 계속 실행됩니다.';

  @override
  String get connectionsForgetConfirm => '삭제';

  @override
  String connectionsMenuAria(String name) {
    return '$name 추가 작업';
  }

  @override
  String get connectionsMenuForget => '호스트 잊기';

  @override
  String get hostScanQr => 'QR 스캔';

  @override
  String get hostScanQrSubtitle => '컴퓨터의 코드로 페어링하세요';

  @override
  String get hostPasteLink => '링크 붙여넣기';

  @override
  String get hostPasteLinkSubtitle => 'EnvoyDev의 페어링 링크를 붙여넣으세요';

  @override
  String get hostPasteLinkTitle => '페어링 링크 붙여넣기';

  @override
  String get hostPasteLinkHint => 'envoy://pair?…';

  @override
  String get hostDirectTcp => '직접 TCP';

  @override
  String get hostDirectTcpSubtitle => '호스트, 포트, 선택적 토큰';

  @override
  String get hostRemoteSsh => '원격 SSH';

  @override
  String get hostRemoteSshSubtitle => 'SSH 홉을 거쳐 서비스에 접속';

  @override
  String get hostFieldHostPort => '호스트:포트';

  @override
  String get hostFieldToken => '토큰(이미 페어링했다면 선택)';

  @override
  String get hostFieldTokenHelper => '이 휴대폰에만 보관되며 목록에 표시되지 않습니다.';

  @override
  String get hostFieldLabel => '라벨(선택)';

  @override
  String get hostFieldSshHost => 'SSH 호스트';

  @override
  String get hostFieldUser => '사용자';

  @override
  String get hostFieldSshPort => 'SSH 포트';

  @override
  String get hostFieldPassword => '비밀번호';

  @override
  String get hostFieldDaemon => '원격 서비스(host:port)';

  @override
  String get hostFieldDaemonHelper => '그 컴퓨터에서는 보통 127.0.0.1:4770입니다';

  @override
  String get hostFieldPairingToken => '페어링 토큰(SSH에서는 선택)';

  @override
  String get hostFieldPairingTokenHelper => '터널이 컴퓨터 자체로 들어오므로 신뢰합니다';

  @override
  String get hostRefusedTitle => '컴퓨터를 추가하지 못했습니다';

  @override
  String get hostScanTitle => '페어링 코드 스캔';

  @override
  String get hostScanHint => '컴퓨터의 QR 코드에 카메라를 맞추세요.';

  @override
  String get hostNoHostsTitle => '아직 페어링된 컴퓨터가 없습니다.';

  @override
  String get hostNoHostsBody =>
      '컴퓨터에서 EnvoyDev를 열고 휴대폰 페어링을 선택한 뒤 코드를 스캔하세요. 휴대폰이 연결되어 있지 않아도 에이전트는 계속 실행됩니다.';

  @override
  String get errorPairingEmpty => '페어링 코드가 비어 있습니다.';

  @override
  String get errorPairingMalformed => '페어링 코드로 보이지 않습니다.';

  @override
  String get errorPairingUnreadable =>
      '페어링 코드를 읽을 수 없습니다. 컴퓨터에서 다시 표시해 달라고 하세요.';

  @override
  String get errorPairingAddress => '페어링 코드에 이 앱이 읽을 수 없는 주소가 있습니다.';

  @override
  String get errorPairingOtherApp => '다른 앱의 코드입니다';

  @override
  String get errorAddHostNotHostPort =>
      '호스트와 포트가 아닙니다. “machine:4770”처럼 쓰세요 — 주소와 서비스가 대기하는 포트입니다.';

  @override
  String get errorAddHostNeedsToken =>
      'EnvoyDev는 컴퓨터 자체가 아닌 곳의 접속을 거부하므로 이 경로에는 페어링 링크의 토큰이 필요합니다. QR 스캔이나 링크 붙여넣기를 쓰거나, 여기에 토큰도 붙여넣으세요.';

  @override
  String get errorAddHostSshHost => '터널이 어느 컴퓨터를 거쳐야 합니까? 그 SSH 호스트를 입력하세요.';

  @override
  String get errorAddHostSshPort =>
      'SSH 포트는 1과 65535 사이의 숫자여야 합니다. 기본값은 22입니다.';

  @override
  String get errorAddHostDaemon =>
      '그 컴퓨터의 서비스는 “host:port”로 씁니다. “127.0.0.1:4770”처럼 쓰세요 — 거의 모든 컴퓨터에서 이 값이고, 그 컴퓨터에서 본 주소입니다.';

  @override
  String get pairingNameTitle => '이 연결의 이름 지정';

  @override
  String get pairingNameField => '연결 이름';

  @override
  String get pairingNameHelper => '연결 목록에 표시됩니다 — 주소도 함께 보관됩니다.';

  @override
  String nameTooLong(int count) {
    return '$count자 이내로 입력하세요.';
  }

  @override
  String get settingsTitle => '설정';

  @override
  String get settingsLoadFailed => '설정을 불러오지 못했습니다.';

  @override
  String get settingsSaveFailed => '설정을 저장하지 못했습니다.';

  @override
  String get settingsSaveNoModel => '설정을 저장했습니다. LLM 설정을 저장하려면 모델을 입력하세요.';

  @override
  String get settingsSavedOnComputer => '컴퓨터에 설정을 저장했습니다.';

  @override
  String get settingsSavedLlmFailed => '설정을 저장했지만 LLM 설정은 저장하지 못했습니다.';

  @override
  String get settingsComputerHeading => '컴퓨터에서';

  @override
  String get settingsComputerDetail => '이 설정은 페어링된 컴퓨터에 있습니다. 휴대폰은 값을 바꿀 뿐입니다.';

  @override
  String get settingsApprovals => '파괴적인 작업 전에 확인';

  @override
  String get settingsTranscripts => '작업이 끝난 뒤에도 기록 유지';

  @override
  String get settingsLanguage => '언어';

  @override
  String get settingsLanguageSystem => '휴대폰 설정을 따름';

  @override
  String get settingsDefaultAgent => '새 작업이 시작하는 에이전트';

  @override
  String get settingsLlmHeading => 'LLM';

  @override
  String get settingsLlmDetail => 'Envoy Harness의 기본 URL, 모델, API 키.';

  @override
  String get settingsBaseUrl => '기본 URL';

  @override
  String get settingsBaseUrlHint => '선택 — 비워 두면 제공자 기본값';

  @override
  String get settingsModel => '모델';

  @override
  String get settingsModelHint => 'gpt-4o or anthropic/claude-sonnet-4-5';

  @override
  String get settingsApiKeySaved => 'API 키가 이 기기에 저장되어 있습니다.';

  @override
  String get settingsApiKey => 'API 키';

  @override
  String get settingsApiKeyHint => '저장된 키를 바꾸려면 새 키를 붙여넣으세요';

  @override
  String get settingsLanguageDaemonFailed => '휴대폰은 이 언어로 바뀌었지만 컴퓨터는 바꾸지 못했습니다.';

  @override
  String get networkTitle => '네트워크 상태';

  @override
  String get networkCheckAgain => '다시 확인';

  @override
  String get networkCopyReport => '보고서 복사';

  @override
  String get networkCopied => '네트워크 보고서를 복사했습니다 — 버그 보고서에 붙여넣으세요.';

  @override
  String get networkTokenNote => '페어링 토큰은 자격 증명이라 여기에 표시하지 않습니다.';

  @override
  String get networkComputer => '컴퓨터';

  @override
  String get networkActiveRoute => '사용 중인 경로';

  @override
  String get networkApp => '앱';

  @override
  String get networkPairingHeading => '페어링으로 받은 정보';

  @override
  String get networkDesktopPeerId => '컴퓨터 피어 ID';

  @override
  String get networkDialablePeers => '연결 가능한 피어 주소';

  @override
  String get networkPairingMissing =>
      '둘 다 있어야 피어 투 피어 경로를 쓸 수 있어 이 호스트에는 그 경로가 없습니다. 컴퓨터가 이 필드를 갖기 전에 만든 페어링에는 둘 다 없어서, 휴대폰에는 직접 주소와 릴레이만 남습니다.';

  @override
  String get networkLadderHeading => '이 컴퓨터를 시도한 방식';

  @override
  String get networkLadderNoCandidatesYet =>
      '아직 후보가 없습니다 — 이 컴퓨터로 시도한 것이 없습니다.';

  @override
  String get networkLadderNoCandidates =>
      '이번 순회에서 후보가 나오지 않았습니다: 연결 시도가 몰려 순회를 미뤘거나, 페어링에 주소가 전혀 없습니다.';

  @override
  String networkLadderLimit(int limit, int waiting, int total) {
    return '이번 순회는 최대 $limit개를 시도합니다: $total개 중 $waiting개가 다음 순회를 기다립니다.';
  }

  @override
  String get networkAttemptConnected => '연결됨';

  @override
  String get networkAttemptFailed => '실패';

  @override
  String get networkAttemptNoAnswer => '응답 없음';

  @override
  String get networkAttemptDialling => '연결 중';

  @override
  String get networkAttemptNotTried => '시도 안 함';

  @override
  String get networkAttemptPlanned => '예정';

  @override
  String get networkLastRequestHeading => '컴퓨터로 보낸 마지막 요청';

  @override
  String get networkNothingAsked => '앱을 시작한 뒤로 아직 아무것도 요청하지 않았습니다.';

  @override
  String get networkMethod => '메서드';

  @override
  String get networkOutcome => '결과';

  @override
  String get networkAnswered => '응답함';

  @override
  String get networkTook => '걸린 시간';

  @override
  String get networkLastWalk => '마지막 순회';

  @override
  String get networkPhoneNodeHeading => '이 휴대폰의 libp2p 노드';

  @override
  String get networkNodeNotStarted =>
      '시작되지 않음 — 이번 실행에서는 피어 투 피어 경로를 한 번도 시도하지 않았습니다. 그런 연결을 처음 시도할 때 시작되며, 이 화면을 보는 것으로는 시작되지 않습니다.';

  @override
  String get networkPeerId => '피어 ID';

  @override
  String get networkStarting => '시작 중';

  @override
  String get networkRelayDialling => '릴레이 연결';

  @override
  String get networkEnabled => '사용';

  @override
  String get networkDisabled => '사용 안 함';

  @override
  String get networkRelayReservation => '릴레이 예약';

  @override
  String get networkConnectedPeers => '연결된 피어';

  @override
  String get networkConnectedPeersUnavailable =>
      '알 수 없음 — 공유 노드가 연결 목록을 제공하지 않습니다';

  @override
  String get networkLanPeers => '발견한 LAN 피어';

  @override
  String get networkMdns => 'mDNS';

  @override
  String get networkActive => '활성';

  @override
  String get networkInactive => '비활성';

  @override
  String get networkRegisteredProtocols => '등록된 프로토콜';

  @override
  String get networkHostGeneration => '호스트 세대';

  @override
  String get networkDesktopMeshHeading => '컴퓨터가 자신에 대해 밝히는 내용';

  @override
  String get networkNotAsked =>
      '아직 묻지 않았습니다. “다시 확인”은 컴퓨터에 자신의 mesh 상태를 묻습니다 — “이 휴대폰이 닿지 못한다”와 “닿을 것이 없다”의 차이입니다.';

  @override
  String networkNoUsableAnswer(String reason) {
    return '쓸 수 있는 답이 없습니다: $reason';
  }

  @override
  String get networkUnreadable => '읽을 수 없음';

  @override
  String get networkState => '상태';

  @override
  String get networkItsPeerId => '컴퓨터의 피어 ID';

  @override
  String get networkItsDialable => '컴퓨터의 연결 가능 주소';

  @override
  String get networkItsRelayHints => '컴퓨터의 릴레이 힌트';

  @override
  String get networkPeersConnected => '연결된 피어 수';

  @override
  String get networkItsReason => '컴퓨터의 이유';

  @override
  String get explorerTitle => '탐색기';

  @override
  String get explorerFiles => '파일';

  @override
  String get explorerChanges => '변경';

  @override
  String get explorerFolderEmpty => '이 폴더는 비어 있습니다.';

  @override
  String get explorerCouldNotList => '이 폴더를 나열할 수 없습니다.';

  @override
  String get explorerNotRepo => '이 폴더는 Git 저장소가 아닙니다.';

  @override
  String get explorerNoChanges => '이 폴더에 변경 사항이 없습니다.';

  @override
  String get explorerCouldNotRead => '변경 사항을 읽지 못했습니다.';

  @override
  String get explorerKindAdded => '추가됨';

  @override
  String get explorerKindModified => '수정됨';

  @override
  String get explorerKindDeleted => '삭제됨';

  @override
  String get explorerKindRenamed => '이름 변경';

  @override
  String get explorerKindNew => '새 파일';

  @override
  String get explorerKindConflict => '충돌';

  @override
  String get folderTitle => '프로젝트 폴더 선택';

  @override
  String get folderUseThisFolder => '이 폴더 사용';

  @override
  String get folderComputer => '컴퓨터';

  @override
  String get folderDrives => '드라이브';

  @override
  String get folderHome => '홈';

  @override
  String get folderParent => '상위 폴더';

  @override
  String get folderEmpty => '하위 폴더가 없습니다';

  @override
  String get runStop => '중지';

  @override
  String get runStopping => '중지 중…';

  @override
  String get runLive => '실행 중';

  @override
  String get runToggleExplorer => '탐색기 사이드바 전환';

  @override
  String get runCouldNotAnswer => '그 답변을 보내지 못했습니다. 다시 시도하세요.';

  @override
  String get runCouldNotUpdateTask => '컴퓨터의 작업을 갱신하지 못했습니다.';

  @override
  String get runCouldNotSend => '보내지 못했습니다. 다시 시도하세요.';

  @override
  String get runCouldNotStop => '실행을 중지하지 못했습니다. 다시 시도하세요.';

  @override
  String get runNoFolder => '이 작업에는 아직 폴더가 없습니다.';

  @override
  String get runCouldNotOpen => '이 실행을 열지 못했습니다.';

  @override
  String get runEarlierNotHere => '이전 대화가 이 컴퓨터에 없습니다. 새 메시지를 보내면 여기서 시작합니다.';

  @override
  String get runHistoryGap => '이 작업의 기록 일부가 도착하지 않았습니다. 여기 있는 내용은 순서대로입니다.';

  @override
  String get runQueue => '대기';

  @override
  String get runSteer => '개입';

  @override
  String get runJoinsTurn => '지금 턴에 들어갑니다';

  @override
  String get runWaitsTurn => '이 턴이 끝나기를 기다립니다';

  @override
  String get runPlaceholderAnswer => '먼저 위 요청에 답하세요';

  @override
  String get runPlaceholderFollowUp => '이어서 보내기…';

  @override
  String get runPlaceholderContinue => '계속하려면 메시지를 보내세요';

  @override
  String get runYou => '나';

  @override
  String get runYouSteered => '나 · 턴에 끼어들었습니다';

  @override
  String get runYouQueued => '나 · 턴을 기다렸습니다';

  @override
  String get runThoughtTitle => '어떻게 생각했는지';

  @override
  String get runAnswered => '답변함';

  @override
  String runAnsweredWith(String option) {
    return '답변함: $option';
  }

  @override
  String get runNeedsAnswer => '에이전트가 당신의 답변을 기다립니다';

  @override
  String approvalQuestionTool(String tool) {
    return '에이전트가 “$tool”을(를) 실행하도록 허용할까요?';
  }

  @override
  String get approvalQuestionGeneric => '에이전트가 계속하도록 허용할까요?';

  @override
  String get approvalQuestionAsk => '에이전트가 질문을 했습니다.';

  @override
  String get approvalDetail =>
      '이 단계 전에 멈춰 있고 당신이 답하기 전에는 계속하지 않습니다. 허용하면 같은 작업은 이 프로젝트에서 다시 묻지 않습니다.';

  @override
  String get approvalDetailPick => '하나를 고르세요. 이 답은 이 질문에만 적용됩니다.';

  @override
  String get approvalDetailMultiple =>
      '해당하는 항목을 모두 고른 다음 확인하세요. 이 답은 이 질문에만 적용됩니다.';

  @override
  String get approvalDetailText => '답을 입력하세요. 보내기 전에는 에이전트가 계속하지 않습니다.';

  @override
  String get approvalAllow => '허용';

  @override
  String get approvalDeny => '허용 안 함';

  @override
  String get runApprovalNeedsDecision => '에이전트가 결정을 기다리고 있습니다.';

  @override
  String get runNoLongerWaiting => '더 이상 기다리지 않습니다.';

  @override
  String get runYourAnswer => '답변 입력';

  @override
  String get runToolFallback => '도구';

  @override
  String runNoteDiff(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '파일 $count개를 변경했습니다.',
      one: '파일 1개를 변경했습니다.',
    );
    return '$_temp0';
  }

  @override
  String runNoteContext(int percent) {
    return '컨텍스트가 $percent% 찼습니다.';
  }

  @override
  String get runNoteFinished => '완료했습니다.';

  @override
  String get runNoteStopped => '중지했습니다.';

  @override
  String get runNoteStoppedBefore => '끝나기 전에 중지했습니다.';

  @override
  String get runNoteEnded => '종료했습니다.';

  @override
  String get attachAdd => '이미지 추가';

  @override
  String get attachTooltip => '첨부';

  @override
  String get attachPaste => '이미지 붙여넣기';

  @override
  String get attachFile => '파일 추가';

  @override
  String attachRemove(String name) {
    return '$name 제거';
  }

  @override
  String get attachTooBig => '파일이 너무 커서 첨부할 수 없습니다.';

  @override
  String get attachBinary => '이미지와 텍스트 파일만 첨부할 수 있습니다.';

  @override
  String get attachUnreadable => '이 파일을 읽을 수 없습니다.';

  @override
  String get attachEmpty => '이 파일은 비어 있습니다.';

  @override
  String attachLimit(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '최대 $count개까지 첨부할 수 있습니다.',
      one: '파일 1개까지 첨부할 수 있습니다.',
    );
    return '$_temp0';
  }

  @override
  String get attachClipboardMissing => '클립보드에 이미지가 없습니다.';

  @override
  String get attachFailed => '파일을 첨부할 수 없습니다.';

  @override
  String get attachImagesOnly => '첨부한 이미지를 봐 주세요.';

  @override
  String get attachImagesOnlyMany => '첨부한 이미지들을 봐 주세요.';

  @override
  String attachNamed(String names) {
    return '첨부: $names';
  }

  @override
  String get addProjectTitle => '프로젝트 추가';

  @override
  String get addProjectDetail => '이 컴퓨터의 폴더를 고르세요. 에이전트는 그 안에서 실행됩니다.';

  @override
  String get addProjectFolder => '폴더';

  @override
  String get addProjectFolderHint => '/Users/you/work/repo';

  @override
  String get addProjectBrowse => '선택…';

  @override
  String get addProjectDefaultAgent => '기본 에이전트';

  @override
  String get addProjectChooseFolder => '이 컴퓨터의 폴더를 고르세요.';

  @override
  String get addProjectSubmit => '프로젝트 추가';

  @override
  String get markdownMermaid =>
      'Mermaid 다이어그램 — 소스는 여기에 표시되고, 차트는 컴퓨터의 데스크톱 앱이 그립니다.';

  @override
  String get markdownCopy => '복사';

  @override
  String get markdownCopied => '복사됨';

  @override
  String projectListAttention(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '작업 $count개가 당신을 기다립니다',
      one: '작업 1개가 당신을 기다립니다',
    );
    return '$_temp0';
  }

  @override
  String get projectListNoProjects => '아직 프로젝트가 없습니다 — 이 컴퓨터에서 폴더를 추가하세요.';

  @override
  String get projectListNoMatch => '검색과 일치하는 것이 없습니다.';

  @override
  String projectListCouldNotLoad(String detail) {
    return '이 컴퓨터에서 작업을 불러올 수 없습니다. $detail';
  }

  @override
  String get commonConnectionFailed => '연결하지 못했습니다.';

  @override
  String get projectListCouldNotChangeAgent => '프로젝트 에이전트를 변경할 수 없습니다.';

  @override
  String projectListRemoveTitle(String project) {
    return '“$project”을(를) 제거할까요?';
  }

  @override
  String get projectListRemoveMessage =>
      '프로젝트가 EnvoyDev에서 사라지고 그 작업도 목록에서 사라집니다 — 삭제가 아니라 보관이며, 그 폴더의 어떤 것도 건드리지 않습니다. 프로젝트 제거는 되돌릴 수 없습니다.';

  @override
  String projectListRemoveFailed(String project) {
    return '“$project”을(를) 제거할 수 없습니다. 아직 목록에 있습니다.';
  }

  @override
  String projectListRemoved(String project) {
    return '“$project”을(를) 제거했습니다.';
  }

  @override
  String projectListRemovedArchived(String project, int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '작업 $count개를 보관했습니다.',
      one: '작업 1개를 보관했습니다.',
    );
    return '“$project”을(를) 제거했습니다. $_temp0';
  }

  @override
  String taskRemoveTitle(String title) {
    return '“$title”을(를) 제거할까요?';
  }

  @override
  String get taskRemoveMessage =>
      '작업 목록에서 사라집니다. 폴더와 파일, 기록은 이 컴퓨터에 그대로 남습니다 — 보관은 삭제가 아닙니다.';

  @override
  String projectListRemoveTaskFailed(String title) {
    return '“$title”을(를) 제거할 수 없습니다. 아직 목록에 있습니다.';
  }

  @override
  String get runCouldNotRemove => '이 작업을 제거할 수 없습니다. 아직 여기에 있습니다.';

  @override
  String get projectListRenameTaskTitle => '작업 이름 바꾸기';

  @override
  String get projectListRenameTaskField => '작업 이름';

  @override
  String get projectListRenameTaskEmpty => '이 작업의 이름을 입력하세요.';

  @override
  String projectListRenameTaskFailed(String title) {
    return '“$title”의 이름을 바꿀 수 없습니다. 이름은 그대로입니다.';
  }

  @override
  String projectListNetworkStatusFor(String host, String state) {
    return '$host의 네트워크 상태 — $state';
  }

  @override
  String projectListSwitchConnection(String host) {
    return '연결 전환 — 현재: $host';
  }

  @override
  String get projectListNoTasks => '아직 이 프로젝트에 작업이 없습니다';

  @override
  String projectListAgentFor(String project) {
    return '“$project”의 에이전트';
  }

  @override
  String get projectListChangeAgent => '에이전트 변경';

  @override
  String get newTaskNoProjects => '이 컴퓨터에 프로젝트를 먼저 추가한 뒤 다시 시도하세요.';

  @override
  String get newTaskProjectLabel => '프로젝트';

  @override
  String get newTaskPromptHint => '작업 설명';

  @override
  String newTaskCouldNotStart(String detail) {
    return '그 작업을 시작할 수 없습니다. $detail';
  }

  @override
  String get composerAgentDefault => '에이전트 자체 기본값';

  @override
  String get composerUse => '사용';

  @override
  String get composerAgentBare => '에이전트';

  @override
  String composerModelValue(String value) {
    return '모델: $value';
  }

  @override
  String composerModeValue(String value) {
    return '모드: $value';
  }

  @override
  String composerThinkingValue(String value) {
    return '사고: $value';
  }

  @override
  String get projectListSearchHint => '작업, 저장소, 경로 검색';

  @override
  String get projectListRemoveConfirm => '프로젝트 제거';

  @override
  String projectListNewTaskIn(Object project) {
    return '$project의 새 작업';
  }

  @override
  String get newTaskTitle => '새 작업';

  @override
  String get newTaskSubmitting => '추가 중…';

  @override
  String get runRemoveTask => '작업 제거';

  @override
  String get composerDefault => '기본값';

  @override
  String get composerModeSheet => '모드';

  @override
  String get composerModeTooltip => '이 작업에서 에이전트가 할 수 있는 일';

  @override
  String get composerModelSheet => '모델';

  @override
  String get composerModelTooltip => '이 작업에서 에이전트가 사용하는 모델';

  @override
  String get composerModelHint => '제공자/모델';

  @override
  String get composerThinkingSheet => '사고';

  @override
  String get composerThinkingTooltip => '에이전트가 답하기 전에 얼마나 생각할지';

  @override
  String get taskUntitled => '제목 없는 작업';

  @override
  String get projectUnknown => '알 수 없는 프로젝트';

  @override
  String get statusQueued => '대기 중';

  @override
  String get statusDone => '완료';

  @override
  String get statusFailed => '실패';

  @override
  String get statusUnknown => '알 수 없음';

  @override
  String get statusNeedsAnswer => '당신의 답변 필요';

  @override
  String get statusWorking => '실행 중';

  @override
  String get statusIdle => '대기';

  @override
  String get statusStopped => '중지됨';
}
