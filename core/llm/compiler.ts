import type { LLMProposal, ProposedAction } from "./governance.js";
import { CONFIDENCE_THRESHOLDS } from "./governance.js";
import type { ExecutionContext } from "../kernel/state-machine.js";

export interface CompiledAction {
  actionId: string;
  sourceActionType: string;
  effectType: string;
  payload: unknown;
  rulesApplied: string[];
}

export interface ExecutionPlan {
  planId: string;
  executionPlanVersion: number;
  compiledAt: string;
  originatingProposalId: string;
  actions: CompiledAction[];
  warnings: string[];
}

export interface CompilationRejection {
  rejected: true;
  reasons: string[];
  proposalId: string;
}

export class DecisionCompiler {
  compile(
    proposal: LLMProposal,
    context: ExecutionContext
  ): ExecutionPlan | CompilationRejection {
    const errors: string[] = [];
    const compiledActions: CompiledAction[] = [];

    for (const action of proposal.proposedActions) {
      const threshold = CONFIDENCE_THRESHOLDS[action.type] ?? 0.75;
      if (proposal.overallConfidence < threshold) {
        errors.push(
          `Action ${action.type} requires confidence >= ${threshold}; got ${proposal.overallConfidence}`
        );
        continue;
      }

      const ruleViolation = this.checkBusinessRules(action, context);
      if (ruleViolation) {
        errors.push(ruleViolation);
        continue;
      }

      compiledActions.push(this.compileAction(action, proposal.proposalId));
    }

    if (compiledActions.length === 0 && errors.length > 0) {
      return { rejected: true, reasons: errors, proposalId: proposal.proposalId };
    }

    return {
      planId: `plan_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      executionPlanVersion: 1,
      compiledAt: new Date().toISOString(),
      originatingProposalId: proposal.proposalId,
      actions: compiledActions,
      warnings: errors,
    };
  }

  private checkBusinessRules(
    action: ProposedAction,
    _context: ExecutionContext
  ): string | null {
    if (action.type === "SEND_MESSAGE" && action.content.length > 4096) {
      return "BUSINESS_RULE_VIOLATION: Message content exceeds maximum length";
    }

    if (action.type === "ESCALATE_TO_HUMAN" && action.priority === "CRITICAL") {
      return null;
    }

    return null;
  }

  private compileAction(action: ProposedAction, proposalId: string): CompiledAction {
    const actionId = `act_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    switch (action.type) {
      case "SEND_MESSAGE":
        return {
          actionId,
          sourceActionType: action.type,
          effectType: "SEND_WHATSAPP_MESSAGE",
          payload: {
            recipientId: action.recipientId,
            messageText: action.content,
            urgency: action.urgency,
          },
          rulesApplied: ["CONTENT_LENGTH_CHECK"],
        };

      case "ESCALATE_TO_HUMAN":
        return {
          actionId,
          sourceActionType: action.type,
          effectType: "SEND_EMAIL_NOTIFICATION",
          payload: {
            reason: action.reason,
            priority: action.priority,
          },
          rulesApplied: ["ESCALATION_POLICY"],
        };

      case "RECORD_CUSTOMER_NEED":
        return {
          actionId,
          sourceActionType: action.type,
          effectType: "WRITE_AUDIT_LOG",
          payload: {
            needType: action.needType,
            detail: action.detail,
          },
          rulesApplied: ["NEED_CLASSIFICATION_POLICY"],
        };

      case "SCHEDULE_FOLLOWUP":
        return {
          actionId,
          sourceActionType: action.type,
          effectType: "WRITE_AUDIT_LOG",
          payload: { reason: action.reason },
          rulesApplied: ["FOLLOWUP_POLICY"],
        };

      case "NO_ACTION":
        return {
          actionId,
          sourceActionType: action.type,
          effectType: "WRITE_AUDIT_LOG",
          payload: { rationale: action.rationale },
          rulesApplied: ["NO_ACTION_PERMITTED"],
        };

      default: {
        const _exhaustive: never = action;
        throw new Error(`Unhandled action type: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}
