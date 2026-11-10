import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { toolSafetyReason } from '../../junior-de-saram/core/tool-safety.mjs';

export default function deSaramScopeGuard(pi: ExtensionAPI) {
  pi.on('tool_call', event => {
    const reason = toolSafetyReason(event.toolName, event.input);
    return reason ? { block: true, reason } : undefined;
  });
}
