# Team space

Share agent progress and visible text conversations with teammates. Only the owner controls the original agent. Teammates can continue from a fixed conversation checkpoint in an independent local agent, private by default.

Each person installs the plugin on their own daemon and joins a self-hosted team service using a single-use invitation. Share or withdraw agents from the Team space screen or Command Center. Administrators can invite and remove members.

Requires Paseo daemon and app 0.15.4 or compatible 0.16 releases, a team service running Node.js 22.13+, and a configured local agent provider for forks. See README.md for deployment and installation instructions.

Conversation text is stored on the team service and sent to the fork creator's selected provider when they ask a question. Native session state, files, tool environment, reasoning and attachment binaries are not copied. Forks run in a separate empty directory on their creator's machine.

Withdrawal stops new access once the service receives it; offline withdrawals are retried. Existing independent forks survive. Synchronization is periodic, with a delay of a few seconds. This release supports one member identity and one team per daemon.
