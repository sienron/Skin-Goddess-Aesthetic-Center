const NAME_CHARACTERS = /^[\p{L}\p{M}\p{Zs}.'’,‘ʼ&\p{Pd}\u30fb]+$/u;
const EMAIL_LOCAL_PART = /^[A-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i;
const EMAIL_DOMAIN = /^[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

function isValidName(value, maxLength = 100) {
  if (typeof value !== 'string') return false;
  const name = value.trim();
  return name.length > 0
    && name.length <= maxLength
    && NAME_CHARACTERS.test(name)
    && /[\p{L}\p{M}]/u.test(name);
}

function isValidEmail(value) {
  if (typeof value !== 'string' || value.length > 254) return false;
  const atIndex = value.indexOf('@');
  if (atIndex <= 0 || atIndex !== value.lastIndexOf('@')) return false;
  const localPart = value.slice(0, atIndex);
  const domain = value.slice(atIndex + 1);
  return localPart.length <= 64
    && domain.length <= 253
    && EMAIL_LOCAL_PART.test(localPart)
    && EMAIL_DOMAIN.test(domain);
}

module.exports = { isValidName, isValidEmail };
