// Rule: no-any-cast-on-session
//
// Catches `something as any` where `something` references the `session`
// identifier (e.g. `session as any`, `session?.user as any`,
// `(ctx.session.user as any).role`). The augmentation in types/index.ts
// already types session.user.role as Role -- casts re-introduce finding T-08.

function mentionsSession(node) {
  if (!node) return false;
  if (node.type === "Identifier") {
    return node.name === "session" || node.name === "ctx" || node.name === "req";
    // Note: `ctx` and `req` are heuristics for Next route-handler contexts that
    // carry session. Some false positives are acceptable; the rule is opt-in via
    // CLAUDE.md and easy to silence per line if needed.
  }
  if (node.type === "MemberExpression") {
    // Only flag if the member chain actually mentions "session" somewhere.
    return (
      memberChainMentionsSession(node) || mentionsSession(node.object)
    );
  }
  if (node.type === "ChainExpression") {
    return mentionsSession(node.expression);
  }
  if (node.type === "TSNonNullExpression") {
    return mentionsSession(node.expression);
  }
  return false;
}

function memberChainMentionsSession(node) {
  if (!node) return false;
  if (node.type === "Identifier" && node.name === "session") return true;
  if (node.type === "MemberExpression") {
    if (
      node.property &&
      node.property.type === "Identifier" &&
      node.property.name === "session"
    ) return true;
    return memberChainMentionsSession(node.object);
  }
  if (node.type === "ChainExpression") return memberChainMentionsSession(node.expression);
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Prevent `as any` casts on session-related expressions.",
    },
    messages: {
      noAnyCastOnSession:
        "Do not cast a session expression to `any`. types/index.ts augments next-auth's Session.user with role: Role -- use the typed access (`session.user.role`). This rule guards regression of finding T-08.",
    },
    schema: [],
  },
  create(context) {
    function check(node) {
      if (
        node.typeAnnotation &&
        node.typeAnnotation.type === "TSAnyKeyword" &&
        mentionsSession(node.expression)
      ) {
        context.report({ node, messageId: "noAnyCastOnSession" });
      }
    }
    return {
      TSAsExpression: check,
      // Also catch the angle-bracket form `<any>x` if it ever shows up in tsx files.
      TSTypeAssertion: check,
    };
  },
};
