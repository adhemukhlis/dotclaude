#!/usr/bin/env sh
# Rewrites Bash commands through RTK to condense their output.
# Collaborators without rtk installed get their commands unchanged.
command -v rtk >/dev/null 2>&1 || exit 0
exec rtk hook claude
