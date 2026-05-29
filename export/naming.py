"""
Custom naming series variable parsers for document naming.
"""

import frappe
from frappe import _
from frappe.utils import getdate
from erpnext.accounts.utils import get_fiscal_year


def parse_fiscal_year(doc: frappe._dict, e=None) -> str:
	"""
	Parse fiscal year variable for naming series.
	Returns fiscal year in format: YRYY (e.g., 2526 for FY 2025-26)
	
	Args:
		doc: Document instance
		
	Returns:
		str: Fiscal year in YRYY format
	"""
	try:
		posting_date: str = doc.get("posting_date") or doc.get("transaction_date") or frappe.utils.today()
		fiscal_year_data = get_fiscal_year(date=posting_date, as_dict=True)
		fiscal_year_name: str = fiscal_year_data.get("name", "")
		
		# Extract year from fiscal year name (e.g., "2025-26" -> "2526")
		if "-" in fiscal_year_name:
			years = fiscal_year_name.split("-")
			if len(years) == 2:
				year1: str = years[0][-2:]
				year2: str = years[1][-2:]
				return f"{year1}{year2}"
		
		# Fallback: use current year
		current_year: int = getdate(posting_date).year
		next_year: int = current_year + 1
		return f"{str(current_year)[-2:]}{str(next_year)[-2:]}"
		
	except Exception as e:
		frappe.log_error(f"Error parsing fiscal year: {str(e)}", "Naming Series - Fiscal Year")
		# Return default value
		current_year: int = getdate().year
		next_year: int = current_year + 1
		return f"{str(current_year)[-2:]}{str(next_year)[-2:]}"
