// This revision changes serialized Batch state. Replacing code on an existing account is unsafe.
throw new Error('Redeploy disabled: this revision changes contract state. Use a new testnet instance; a migration requires a separate design and review.');
