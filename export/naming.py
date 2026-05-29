"""
Custom naming series variable parsers for document naming.
"""

import frappe
from frappe.utils import getdate
from erpnext.accounts.utils import get_fiscal_year


def _get_fiscal_year_parts(doc) -> tuple[str, str]:
	"""Returns (year1, year2) as 2-digit strings, e.g. ('25', '26')."""
	posting_date = doc.get("posting_date") or doc.get("transaction_date") or frappe.utils.today()
	fiscal_year_data = get_fiscal_year(date=posting_date, as_dict=True)
	fiscal_year_name: str = fiscal_year_data.get("name", "")

	if "-" in fiscal_year_name:
		years = fiscal_year_name.split("-")
		if len(years) == 2:
			return years[0][-2:], years[1][-2:]

	# Fallback: derive from posting date
	current_year = getdate(posting_date).year
	return str(current_year)[-2:], str(current_year + 1)[-2:]


def parse_fiscal_year(doc: frappe._dict, e=None) -> str:
	"""Returns fiscal year with hyphen, e.g. 25-26."""
	try:
		y1, y2 = _get_fiscal_year_parts(doc)
		return f"{y1}-{y2}"
	except Exception as err:
		frappe.log_error(f"Error parsing fiscal year: {str(err)}", "Naming Series - Fiscal Year")
		current_year = getdate().year
		return f"{str(current_year)[-2:]}-{str(current_year + 1)[-2:]}"


def parse_fiscal_year_compact(doc: frappe._dict, e=None) -> str:
	"""Returns fiscal year without hyphen, e.g. 2526."""
	try:
		y1, y2 = _get_fiscal_year_parts(doc)
		return f"{y1}{y2}"
	except Exception as err:
		frappe.log_error(f"Error parsing fiscal year: {str(err)}", "Naming Series - Fiscal Year")
		current_year = getdate().year
		return f"{str(current_year)[-2:]}{str(current_year + 1)[-2:]}"
