app_name = "export"
app_title = "Export"
app_publisher = "Hybrowlabs Technologies Pvt Ltd"
app_description = "Export"
app_email = "pragati@mail.hybrowlabs.com"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "export",
# 		"logo": "/assets/export/logo.png",
# 		"title": "Export",
# 		"route": "/export",
# 		"has_permission": "export.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/export/css/export.css"
# app_include_js = "/assets/export/js/export.js"

# include js, css files in header of web template
# web_include_css = "/assets/export/css/export.css"
# web_include_js = "/assets/export/js/export.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "export/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "export/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "export.utils.jinja_methods",
# 	"filters": "export.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "export.install.before_install"
# after_install = "export.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "export.uninstall.before_uninstall"
# after_uninstall = "export.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "export.utils.before_app_install"
# after_app_install = "export.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "export.utils.before_app_uninstall"
# after_app_uninstall = "export.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "export.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"export.tasks.all"
# 	],
# 	"daily": [
# 		"export.tasks.daily"
# 	],
# 	"hourly": [
# 		"export.tasks.hourly"
# 	],
# 	"weekly": [
# 		"export.tasks.weekly"
# 	],
# 	"monthly": [
# 		"export.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "export.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "export.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "export.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["export.utils.before_request"]
# after_request = ["export.utils.after_request"]

# Job Events
# ----------
# before_job = ["export.utils.before_job"]
# after_job = ["export.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"export.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

boot_session = [
    "export.api.boot.add_bank_account_numbers",
]

doctype_js = {
    "Sales Order": "public/js/sales_order.js",
    "Sales Invoice": "public/js/sales_invoice.js",
    "Delivery Note": "public/js/delivery_note.js",
    "Packing Slip": "public/js/packing_slip.js",
    "Purchase Order": "public/js/purchase_order.js",
    "Purchase Receipt": "public/js/purchase_receipt.js",
    "Purchase Invoice": "public/js/purchase_invoice.js",
    "Journal Entry": "public/js/journal_entry.js",
    "Exchange Rate Revaluation": "public/js/exchange_rate_revaluation.js",
    "Payment Entry": "public/js/payment_entry.js",
    "Quotation": "public/js/quotation.js"
}


doc_events = {
    "Item": {
        "before_save": "export.api.item.before_save",
    },
    "BOM": {
        "on_submit": "export.api.item.bom_on_submit",
    },
    "Purchase Invoice": {
        "validate": "export.api.purchase_invoice.validate",
    },
    "Journal Entry": {
        "before_save": "export.api.journal_entry.round_exchange_gain_loss_amounts",
    },
    "Payment Entry": {
        "validate": "export.api.payment_entry.validate",
        "on_submit": "export.api.payment_entry.round_payment_entry_gl_amounts",
    },
    "Sales Invoice": {
        "validate": "export.api.sales_invoice.validate",
        "on_submit": "export.api.sales_invoice.round_sales_invoice_gl_amounts",
    },
}

override_whitelisted_methods = {
    "erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice":
        "export.config.py.sales_order.make_sales_invoice_custom",

    "erpnext.selling.doctype.sales_order.sales_order.make_delivery_note":
        "export.config.py.sales_order.make_delivery_note_custom",

    # Override Delivery Note → Packing Slip mapping to carry forward custom fields
    "erpnext.stock.doctype.delivery_note.delivery_note.make_packing_slip":
        "export.api.packing_slip.make_packing_slip_custom",

    # Override Delivery Note → Sales Invoice to merge split qty-1 rows back into
    # consolidated lines before the invoice is created
    "erpnext.stock.doctype.delivery_note.delivery_note.make_sales_invoice":
        "export.api.delivery_note_to_si.make_sales_invoice_custom",
}

naming_series_variables = {
    "EXFY": "export.naming.parse_fiscal_year",          # e.g. 25-26
    "EXFYC": "export.naming.parse_fiscal_year_compact", # e.g. 2526
}