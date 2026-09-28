// Maps a service's category to the staff role that performs it. Services outside
// the nail tech's categories default to the aesthetician role.
const NAIL_TECH_CATEGORIES = ['Soft Gel Nail Extensions', 'HAND TREATMENT', 'PARAFFIN THERAPY', 'FOOT TREATMENT'];

function roleForCategory(category) {
  return NAIL_TECH_CATEGORIES.includes(category) ? 'nail_tech' : 'aesthetician';
}

module.exports = { NAIL_TECH_CATEGORIES, roleForCategory };
