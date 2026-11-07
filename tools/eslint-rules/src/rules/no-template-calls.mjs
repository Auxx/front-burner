/** Whether a `BoundEvent` is among the ancestors of `node`. */
function insideEventHandler(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'BoundEvent') {
      return true;
    }
  }
  return false;
}

/**
 * `front-burner/no-template-calls`: a template calls functions only to read
 * signals (no arguments), to call the functions named in `allowedFunctions`
 * (translation helpers) and to handle events. Anything else belongs in a
 * `computed()` signal or a pipe.
 */
export default {
  meta: {
    type: 'suggestion',
    schema: [
      {
        type: 'object',
        properties: { allowedFunctions: { type: 'array', items: { type: 'string' }, uniqueItems: true } },
        additionalProperties: false
      }
    ],
    docs: { description: 'Allow calls in templates only to read signals, translate or handle events.' },
    messages: {
      call:
        'Templates call functions only to read signals, translate or handle events; move this into a computed() signal or a pipe.'
    }
  },

  defaultOptions: [ { allowedFunctions: [] } ],

  create(context) {
    const allowed = new Set(context.options[0]?.allowedFunctions ?? []);

    function check(node) {
      if (!node.args.length || insideEventHandler(node)) {
        return;
      }
      const callee = node.receiver;
      if (callee.receiver?.type === 'ImplicitReceiver' && allowed.has(callee.name)) {
        return;
      }
      context.report({ node, messageId: 'call' });
    }

    return { Call: check, SafeCall: check };
  }
};
