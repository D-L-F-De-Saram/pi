// The OpenAI Responses fields emitted by Pi's built-in provider. Omitted
// endpoints, stored response references, and hosted tools are outside this gateway.
const only = (value, fields) => value !== null && typeof value === "object" && !Array.isArray(value) &&
	Object.keys(value).every((key) => fields.includes(key));
const text = (value) => typeof value === "string";
const optionalText = (value) => value === undefined || text(value);

function localTool(tool) {
	if (tool?.type === "function") {
		return only(tool, ["type", "name", "description", "parameters", "strict", "defer_loading"]) && text(tool.name);
	}
	return tool?.type === "custom" && only(tool, ["type", "name", "description", "format", "defer_loading"]) &&
		text(tool.name) && only(tool.format, ["type", "syntax", "definition"]) && tool.format.type === "grammar" &&
		text(tool.format.syntax) && text(tool.format.definition);
}

function inlinePart(part) {
	if (part?.type === "input_text") return only(part, ["type", "text"]) && text(part.text);
	return part?.type === "input_image" && only(part, ["type", "detail", "image_url"]) &&
		(part.detail === undefined || ["auto", "low", "high", "original"].includes(part.detail)) &&
		text(part.image_url) && /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(part.image_url);
}

function outputPart(part) {
	return part?.type === "output_text" && only(part, ["type", "text", "annotations"]) && text(part.text) &&
		(part.annotations === undefined || (Array.isArray(part.annotations) && part.annotations.length === 0));
}

function replayText(part, type) {
	return only(part, ["type", "text"]) && part.type === type && text(part.text);
}

function reasoningConfig(value) {
	return only(value, ["effort", "summary"]) && optionalText(value.effort) && optionalText(value.summary);
}

function responseItem(item) {
	switch (item?.type) {
		case undefined:
		case "message": {
			if (!only(item, ["type", "role", "content", "status", "id", "phase"]) ||
				!["user", "system", "developer", "assistant"].includes(item.role)) return false;
			if (item.role === "assistant") return Array.isArray(item.content) && item.content.every(outputPart);
			return item.id === undefined && (text(item.content) || (Array.isArray(item.content) && item.content.every(inlinePart)));
		}
		case "function_call":
		case "custom_tool_call": {
			const field = item.type === "function_call" ? "arguments" : "input";
			return only(item, ["type", "id", "call_id", "name", field, "namespace"]) &&
				text(item.call_id) && text(item.name) && text(item[field]);
		}
		case "function_call_output":
		case "custom_tool_call_output":
			return only(item, ["type", "call_id", "output"]) && text(item.call_id) &&
				(text(item.output) || (Array.isArray(item.output) && item.output.every(inlinePart)));
		case "reasoning":
			return only(item, ["type", "id", "summary", "content", "encrypted_content", "status"]) &&
				text(item.id) && text(item.encrypted_content) && item.encrypted_content.length > 0 &&
				Array.isArray(item.summary) && item.summary.every((part) => replayText(part, "summary_text")) &&
				(item.content == null || (Array.isArray(item.content) && item.content.every((part) => replayText(part, "reasoning_text"))));
		case "configuration_update":
			return only(item, ["type", "reasoning"]) && reasoningConfig(item.reasoning);
		case "additional_tools":
			return only(item, ["type", "role", "tools"]) && item.role === "developer" &&
				Array.isArray(item.tools) && item.tools.every(localTool);
		case "tool_search_call":
			return only(item, ["type", "call_id", "execution", "status", "arguments"]) &&
				item.execution === "client" && item.status === "completed" && text(item.call_id) &&
				only(item.arguments, ["query", "limit"]) && text(item.arguments.query) && Number.isInteger(item.arguments.limit);
		case "tool_search_output":
			return only(item, ["type", "call_id", "execution", "status", "tools"]) &&
				item.execution === "client" && item.status === "completed" && text(item.call_id) &&
				Array.isArray(item.tools) && item.tools.every(localTool);
		default:
			return false;
	}
}

const FIELDS = ["model", "input", "stream", "store", "max_output_tokens", "temperature", "top_p", "service_tier",
	"prompt_cache_key", "prompt_cache_options", "reasoning", "include", "tools", "tool_choice", "parallel_tool_calls"];

export function openaiCallProblem(body, allowedModel) {
	if (!only(body, FIELDS)) return "an unsupported OpenAI request field was supplied";
	if (!allowedModel || body.model !== allowedModel) return "that model isn't allowed";
	if (body.stream !== true || body.store !== false) return "OpenAI calls must stream and disable response storage";
	if (!Array.isArray(body.input) || !body.input.every(responseItem)) return "only inline transcript items are allowed";
	if (body.tools !== undefined && !(Array.isArray(body.tools) && body.tools.every(localTool))) return "only Pi's client tools are allowed";
	if (body.tool_choice !== undefined && !["auto", "none", "required"].includes(body.tool_choice) &&
		!(only(body.tool_choice, ["type", "name"]) && ["function", "custom"].includes(body.tool_choice.type) && text(body.tool_choice.name))) {
		return "only Pi's client tools may be selected";
	}
	if (body.reasoning !== undefined && !reasoningConfig(body.reasoning)) return "unsupported reasoning settings";
	if (body.include !== undefined && !(Array.isArray(body.include) && body.include.every((v) => v === "reasoning.encrypted_content"))) {
		return "only encrypted reasoning replay may be included";
	}
	if (!optionalText(body.prompt_cache_key) ||
		(body.prompt_cache_options !== undefined && !(only(body.prompt_cache_options, ["mode"]) && body.prompt_cache_options.mode === "explicit"))) {
		return "unsupported prompt cache settings";
	}
	return undefined;
}
