const DEMO_CUSTOMER_EMAIL = 'demo.client@skingoddess.test';

function isDemoCustomerFeatureEnabled(env = process.env) {
  return env.NODE_ENV === 'production'
    && env.DEMO_CUSTOMER_MFA_BYPASS === 'true';
}

function isDemoCustomerAccount(user) {
  return typeof user?.email === 'string'
    && user.email.trim().toLowerCase() === DEMO_CUSTOMER_EMAIL
    && user?.role === 'client';
}

function isDemoCustomer(user, env = process.env) {
  return isDemoCustomerFeatureEnabled(env)
    && isDemoCustomerAccount(user)
    && user?.mfa_enabled === false;
}

function isDemoCustomerEmail(email) {
  return typeof email === 'string'
    && email.trim().toLowerCase() === DEMO_CUSTOMER_EMAIL;
}

function assertDemoCustomerExternalOperationAllowed(operation, email) {
  if (isDemoCustomerEmail(email)) {
    throw new Error(`${operation} is disabled for the survey account.`);
  }
}

function assertValidDemoCustomerConfiguration(env = process.env) {
  if (env.DEMO_CUSTOMER_MFA_BYPASS === 'true' && env.NODE_ENV !== 'production') {
    throw new Error('DEMO_CUSTOMER_MFA_BYPASS may only be enabled in production.');
  }
}

module.exports = {
  DEMO_CUSTOMER_EMAIL,
  assertDemoCustomerExternalOperationAllowed,
  assertValidDemoCustomerConfiguration,
  isDemoCustomerAccount,
  isDemoCustomer,
  isDemoCustomerEmail,
};
