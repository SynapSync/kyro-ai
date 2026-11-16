
export { KYRO_SCOPE_ENTRY_STATUS, TASK_DISPOSITION_KIND, TASK_DISPOSITION_TARGET_KIND, TASK_VERDICT_RESULT, TASK_VERDICT_FINDING_SEVERITY, SPEC_REQUIREMENT_PRIORITY, ADR_STATUS, ADR_LINK_KEYS, SPRINT_CLOSE_CHECKPOINT_KIND, SPRINT_CLOSE_CHECKPOINT_SCHEMA_VERSION, SCOPE_RECERTIFICATION_KIND, SCOPE_RECERTIFICATION_SCHEMA_VERSION, SPRINT_CLOSE_OUTCOME, SPRINT_CLOSE_TRANSACTION_STATUS } from './types/vocabularies';
export type { KyroScopeEntryStatus, TaskDispositionKind, TaskDispositionTargetKind, TaskVerdictResult, TaskVerdictFindingSeverity, SpecRequirementPriority, AdrStatus, AdrLinkKey, SprintCloseOutcome, SprintCloseTransactionStatus } from './types/vocabularies';
export type { ScopeRetirement, ScopeCompletion, ScopeReopenRecord, NextAction, Clarification, TaskStatus, DebtStatus, TaskExecutionState, TaskBlockReason, TaskExecutionInfo, TaskDispositionTarget, TaskDisposition, ConventionRetirementReason, Convention, AdrLinks, AdrRecord, Roadmap, LedgerEntry, SprintGitStart, SprintGitEnd, LedgerGitRange, TaskEvidence, TaskVerdictFinding, WaivedCriterion, TaskVerdict, SpecRequirement, SpecScenario, Spec, Task, Phase, ActiveSprint, Debt, HandoffBlocker, Handoff, ScopeAuthorSource, ScopeAuthor, SprintFile } from './types/sprint-model';
export type { Agent, InstallScope, KyroCommandName, KyroInstalledAdapter, MachineAdapterEntry, MachineAdapterRegistry, KyroScopeEntry, PrincipleCheck, Principle, TeamPolicy, ExecutionPreferences, KyroSharedProjectState, KyroLocalProjectState, LocalGitPreferences, KyroProjectState } from './types/project-state';
export type { SprintCloseIdentity, SprintCloseInputs, SprintClosePaths, SprintCloseDigests, SprintCloseCheckpointV1 } from './types/sprint-close';
export type { ScopeVerificationState, ScopeVerification, RemediationAnchor, CertificationAnchor, CertificationEvidenceKyroVerdictSource, CertificationEvidenceExternalArtifactSource, CertificationEvidenceSource, CertificationEvidence, CertificationVerdict, CertificationProvenance, ScopeRecertificationV1 } from './types/certification';
export type { KyroManifest, CliOptions, ContextPackMode, PackVerbosity, BudgetClassId, ReasoningTier, BudgetClassDefinition, BudgetManifest, OperationPlan, OperationProjectionResult } from './types/cli-runtime';
export type { GuardedOperation, GuardLevel, GuardDecisionKind, EnforcementTier, PolicyOperationRule, PolicyDefinition, MakerCheckerPolicy, PolicyIssue, GuardContext, GuardDecision, TraceEventType, TraceEventBase, TraceEvent, AnalysisSeverity, AnalysisFinding, CheckResult } from './types/guard-trace';
export type { ContextPackConvention, ContextPackAdr, NextTaskReview, ContextPackCliRecipe, ContextPackReopen, ContextPackExecutionSummary, ValidationTaskRule, ValidationMap, SprintValidationFileSource, SprintValidationFile, SprintValidation, ContextPackValidation, ContextPackOutput } from './types/context-pack';
export type { WorkState, WorkTaskStatus, WorkNextAction, WorkFileReference, WorkSourceIdea, WorkBrief, WorkHandoff, WorkValidation, WorkTaskDefinition, WorkEvidence, WorkFinding, WorkVerdict, WorkBlocker, WorkDisposition, WorkTask, WorkActivity, WorkClosure, WorkPromotion, WorkPromotionKind, WorkPromotionTransfer, WorkPromotionOmission, WorkPromotionAdjudication, WorkPromotionPreview, WorkPromotionSidecar, WorkPromotionJournal, WorkFile } from './types/work';


/**
 * `Debt` above is the exact canonical *output* every writer must emit. The raw *input* contract —
 * what an observed legacy entry actually is, and whether it may be projected at all — lives in
 * `artifacts/debt-contract`. Re-exported as types only, so this module stays free of imports.
 */
export type {
  DebtAssessment,
  DebtAssessmentOptions,
  DebtClassification,
  DebtDiagnostic,
  DebtDiagnosticAuthority,
  DebtDiagnosticCode,
  DebtDiagnosticSeverity,
} from './artifacts/debt-contract';