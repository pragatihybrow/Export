/************************************
 * SALES ORDER (PARENT)
 ************************************/
frappe.ui.form.on("Sales Order", {
    refresh(frm) {
        toggle_export_fields(frm);
        toggle_cif_total_by_currency(frm);
        toggle_sub_items_columns(frm);
        hide_items_rows(frm);

        setup_items_grid_template_buttons(frm);
        setup_sub_items_grid_template_buttons(frm);

        // Sub-items table configuration (only if field exists)
        if (frm.fields_dict.custom_sub_items) {
            frm.fields_dict.custom_sub_items.grid.cannot_add_rows = true;

            // Set fields as read-only, checking if they exist first
            const readonly_fields = ['parent_item', 'parent_item_name', 'sub_item_code', 'sub_item_name'];
            readonly_fields.forEach(function(fieldname) {
                if (frm.fields_dict.custom_sub_items.grid.docfields.find(f => f.fieldname === fieldname)) {
                    frm.fields_dict.custom_sub_items.grid.update_docfield_property(fieldname, 'read_only', 1);
                }
            });

            frm.refresh_field('custom_sub_items');
        }
    },

    order_type(frm) {
        toggle_export_fields(frm);
        toggle_sub_items_columns(frm);
        calculate_so_cif_totals(frm);
    },

    currency(frm) {
        toggle_cif_total_by_currency(frm);
        calculate_so_cif_totals(frm);
    },

    validate(frm) {
        // Recalculate all sub-item values first
        if (frm.doc.custom_sub_items) {
            frm.doc.custom_sub_items.forEach(row => {
                calculate_sub_item_cif_values(frm, 'Sales Order Sub Item', row.name);
            });
        }

        apply_parent_values_from_sub_items(frm);
        calculate_so_cif_totals(frm);
        // Don't toggle fields during validate to avoid errors

        // Add Bank Charges item at the end when order type is Export
        // Commented out: reverting CIF difference adjustment via Bank Charges
        // if (frm.doc.order_type === "Export") {
        //     add_bank_charges_item(frm);
        //     hide_items_rows(frm);
        // }
    },
    
    onload_post_render(frm) {
        toggle_export_fields(frm);
        toggle_sub_items_columns(frm);
        hide_items_rows(frm);
    }
});

/************************************
 * ITEMS TEMPLATE BUTTONS (items grid)
 ************************************/
function _hide_standard_items_template_buttons(frm) {
    const grid = frm.fields_dict?.items?.grid;
    if (!grid) return;
    const $wrapper = $(grid.wrapper);
    $wrapper.find('.grid-download, .grid-upload').hide();
    $wrapper.find('[data-label="Download"], [data-label="Upload"]')
        .closest('li').hide();
}

function setup_items_grid_template_buttons(frm) {
    const grid = frm.fields_dict?.items?.grid;
    if (!grid) return;

    const $wrapper = $(grid.wrapper);
    if (!$wrapper.hasClass('so-items-grid-custom')) {
        $wrapper.addClass('so-items-grid-custom');
        if (!$('#so-items-grid-custom-style').length) {
            $('<style id="so-items-grid-custom-style">' +
              '.so-items-grid-custom .grid-download,' +
              '.so-items-grid-custom .grid-upload { display:none !important; }' +
              '</style>').appendTo('head');
        }
    }
    _hide_standard_items_template_buttons(frm);

    setTimeout(() => {
        _hide_standard_items_template_buttons(frm);

        const $footer = $wrapper.find('.grid-footer');
        if ($footer.length && !$footer.is(':visible')) {
            $footer.css('display', 'flex');
            $footer.find('.grid-buttons').hide();
        }

        if ($wrapper.find('.custom-so-template-btns').length) return;

        const $custom = $('<div class="custom-so-template-btns flex gap-2"></div>');

        $custom.append(
            $('<button class="btn btn-xs btn-secondary">')
                .text(__('Download Template'))
                .on('click', () => {
                    const so = (!frm.is_new() && frm.doc.name)
                        ? encodeURIComponent(frm.doc.name)
                        : '';
                    const url = frappe.urllib.get_full_url(
                        '/api/method/export.api.so_items_template.get_so_items_template'
                        + (so ? `?sales_order=${so}` : '')
                    );
                    window.open(url, '_blank');
                })
        );

        $custom.append(
            $('<button class="btn btn-xs btn-secondary">')
                .text(__('Upload Template'))
                .on('click', () => {
                    if (frm.is_new()) {
                        frappe.msgprint(__('Please save the Sales Order before uploading.'));
                        return;
                    }
                    show_items_upload_dialog(frm);
                })
        );

        const $downloadBtn = $wrapper.find('.grid-download');
        if ($downloadBtn.length && !$downloadBtn.parent().is($footer)) {
            // download button is inside a right-side wrapper div — inject alongside it
            $downloadBtn.parent().append($custom);
        } else {
            // no download button, or it is a direct child of the footer flex container —
            // use margin-left:auto to pin our buttons to the right edge
            $custom.css('margin-left', 'auto');
            ($footer.length ? $footer : $wrapper).append($custom);
        }
    }, 400);
}

function show_items_upload_dialog(frm) {
    const d = new frappe.ui.Dialog({
        title: __('Upload Items Template'),
        fields: [
            {
                label: __('File (.xlsx or .csv)'),
                fieldname: 'template_file',
                fieldtype: 'Attach',
                reqd: 1,
                description: __(
                    'Upload the filled items template. ' +
                    'Row 1 = labels, Row 2 = fieldnames, Row 3+ = data. ' +
                    'Each row needs item_code.'
                )
            }
        ],
        primary_action_label: __('Import'),
        primary_action(values) {
            if (!values.template_file) {
                frappe.msgprint(__('Please attach a file first.'));
                return;
            }
            const ext = values.template_file.split('.').pop().toLowerCase();
            if (!['xlsx', 'csv'].includes(ext)) {
                frappe.msgprint(__('Only .xlsx and .csv files are supported.'));
                return;
            }

            d.set_df_property('template_file', 'read_only', 1);
            d.get_primary_btn().prop('disabled', true).text(__('Importing…'));

            frappe.call({
                method: 'export.api.so_items_template.import_so_items',
                args: {
                    sales_order: frm.doc.name,
                    file_url: values.template_file
                },
                callback(r) {
                    d.hide();
                    if (r.message) {
                        frappe.show_alert({
                            message: __(r.message.message),
                            indicator: 'green'
                        }, 6);
                        frm.reload_doc();
                    }
                },
                error() {
                    d.set_df_property('template_file', 'read_only', 0);
                    d.get_primary_btn().prop('disabled', false).text(__('Import'));
                }
            });
        }
    });
    d.show();
}


/************************************
 * SUB-ITEMS TEMPLATE BUTTONS (custom_sub_items grid)
 ************************************/
function _hide_standard_sub_items_template_buttons(frm) {
    const grid = frm.fields_dict?.custom_sub_items?.grid;
    if (!grid) return;
    const $wrapper = $(grid.wrapper);
    $wrapper.find('.grid-download, .grid-upload').hide();
    $wrapper.find('[data-label="Download"], [data-label="Upload"]')
        .closest('li').hide();
}

function setup_sub_items_grid_template_buttons(frm) {
    const grid = frm.fields_dict?.custom_sub_items?.grid;
    if (!grid) return;

    const $wrapper = $(grid.wrapper);
    if (!$wrapper.hasClass('so-sub-items-grid-custom')) {
        $wrapper.addClass('so-sub-items-grid-custom');
        if (!$('#so-sub-items-grid-custom-style').length) {
            $('<style id="so-sub-items-grid-custom-style">' +
              '.so-sub-items-grid-custom .grid-download,' +
              '.so-sub-items-grid-custom .grid-upload { display:none !important; }' +
              '</style>').appendTo('head');
        }
    }
    _hide_standard_sub_items_template_buttons(frm);

    setTimeout(() => {
        _hide_standard_sub_items_template_buttons(frm);

        const $footer = $wrapper.find('.grid-footer');
        if ($footer.length && !$footer.is(':visible')) {
            $footer.css('display', 'flex');
            $footer.find('.grid-buttons').hide();
        }

        if ($wrapper.find('.custom-so-sub-items-template-btns').length) return;

        const $custom = $('<div class="custom-so-sub-items-template-btns flex gap-2"></div>');

        $custom.append(
            $('<button class="btn btn-xs btn-secondary">')
                .text(__('Download Sub Items Template'))
                .on('click', () => {
                    const so = (!frm.is_new() && frm.doc.name)
                        ? encodeURIComponent(frm.doc.name)
                        : '';
                    const url = frappe.urllib.get_full_url(
                        '/api/method/export.api.so_sub_items_template.get_so_sub_items_template'
                        + (so ? `?sales_order=${so}` : '')
                    );
                    window.open(url, '_blank');
                })
        );

        $custom.append(
            $('<button class="btn btn-xs btn-secondary">')
                .text(__('Upload Sub Items Template'))
                .on('click', () => {
                    if (frm.is_new()) {
                        frappe.msgprint(__('Please save the Sales Order before uploading.'));
                        return;
                    }
                    show_sub_items_upload_dialog(frm);
                })
        );

        const $downloadBtn = $wrapper.find('.grid-download');
        if ($downloadBtn.length && !$downloadBtn.parent().is($footer)) {
            // download button is inside a right-side wrapper div — inject alongside it
            $downloadBtn.parent().append($custom);
        } else {
            // no download button, or it is a direct child of the footer flex container —
            // use margin-left:auto to pin our buttons to the right edge
            $custom.css('margin-left', 'auto');
            ($footer.length ? $footer : $wrapper).append($custom);
        }
    }, 400);
}

function show_sub_items_upload_dialog(frm) {
    const d = new frappe.ui.Dialog({
        title: __('Upload Sub Items Template'),
        fields: [
            {
                label: __('File (.xlsx or .csv)'),
                fieldname: 'template_file',
                fieldtype: 'Attach',
                reqd: 1,
                description: __(
                    'Upload the filled sub items template. ' +
                    'Row 1 = labels, Row 2 = fieldnames, Row 3+ = data. ' +
                    'Each row needs parent_item and sub_item_code.'
                )
            }
        ],
        primary_action_label: __('Import'),
        primary_action(values) {
            if (!values.template_file) {
                frappe.msgprint(__('Please attach a file first.'));
                return;
            }
            const ext = values.template_file.split('.').pop().toLowerCase();
            if (!['xlsx', 'csv'].includes(ext)) {
                frappe.msgprint(__('Only .xlsx and .csv files are supported.'));
                return;
            }

            d.set_df_property('template_file', 'read_only', 1);
            d.get_primary_btn().prop('disabled', true).text(__('Importing…'));

            frappe.call({
                method: 'export.api.so_sub_items_template.import_so_sub_items',
                args: {
                    sales_order: frm.doc.name,
                    file_url: values.template_file
                },
                callback(r) {
                    d.hide();
                    if (r.message) {
                        frappe.show_alert({
                            message: __(r.message.message),
                            indicator: 'green'
                        }, 6);
                        frm.reload_doc();
                    }
                },
                error() {
                    d.set_df_property('template_file', 'read_only', 0);
                    d.get_primary_btn().prop('disabled', false).text(__('Import'));
                }
            });
        }
    });
    d.show();
}


function hide_items_rows(frm) {
    const grid = frm.fields_dict?.items?.grid;
    if (!grid) return;

    const hide = () => {
        const rows = grid.grid_rows || [];
        if (!rows.length) return;

        // Example 1: hide by item_code
        rows.forEach((row) => {
            if (row?.doc?.item_code === "Bank Charges") {
                row.wrapper.hide();
            }
        });

        // Example 2: hide last row (uncomment if needed)
        // rows[rows.length - 1].wrapper.hide();
    };

    // Grid can re-render after refresh/reset, so defer once
    setTimeout(hide, 0);
}


function apply_parent_values_from_sub_items(frm) {
    if (!frm.doc.items || !frm.doc.custom_sub_items) return;

    let sub_items = frm.doc.custom_sub_items || [];
    if (!sub_items.length) return;

    let grouped = {};
    sub_items.forEach(sub => {
        let key = sub.parent_row_uid;
        if (!key) return;

        if (!grouped[key]) {
            grouped[key] = {
                rate_sum: 0,
                qty: null,
                has_qty: false,
                freight_pct: null,
                has_freight: false
            };
        }

        grouped[key].rate_sum += flt(sub.rate);

        if (!grouped[key].has_qty && (sub.qty || sub.qty === 0)) {
            grouped[key].qty = flt(sub.qty);
            grouped[key].has_qty = true;
        }

        if (!grouped[key].has_freight && (sub.custom_freight__insurance_ || sub.custom_freight__insurance_ === 0)) {
            grouped[key].freight_pct = flt(sub.custom_freight__insurance_);
            grouped[key].has_freight = true;
        }
    });

    let conversion_rate = flt(frm.doc.conversion_rate) || 1;

    (frm.doc.items || []).forEach(row => {
        let group = grouped[row.custom_row_uid];
        if (!group) return;

        let next_rate = group.rate_sum;
        let next_qty = group.has_qty ? group.qty : flt(row.qty);
        let next_freight = group.has_freight ? group.freight_pct : flt(row.custom_freight__insurance_);

        frappe.model.set_value(row.doctype, row.name, "rate", next_rate);

        if (group.has_qty) {
            frappe.model.set_value(row.doctype, row.name, "qty", next_qty);
        }

        if (group.has_freight) {
            frappe.model.set_value(row.doctype, row.name, "custom_freight__insurance_", next_freight);
        }

        let base_rate = next_rate * conversion_rate;
        let amount = next_rate * next_qty;

        frappe.model.set_value(row.doctype, row.name, "base_rate", base_rate);
        frappe.model.set_value(row.doctype, row.name, "amount", amount);

        calculate_cif_values(frm, row.doctype, row.name);
    });
}


function toggle_cif_total_by_currency(frm) {
    const show = frm.doc.currency !== "INR";
    frm.toggle_display("custom_cif_total_amount_", show);
}


function toggle_sub_items_columns(frm) {
    if (!frm.fields_dict.custom_sub_items) return;

    const is_export = frm.doc.order_type === "Export";

    let grid = frm.fields_dict.custom_sub_items.grid;
    let columns_to_show = [];

    if (is_export) {
        // Columns for Export order type — sequence matches business spec exactly
        columns_to_show = [
            { fieldname: 'parent_item',                        columns: 1 },
            { fieldname: 'sub_item_code',                      columns: 1 },
            { fieldname: 'sub_description',                    columns: 1 },
            { fieldname: 'gst_hsn_code',                       columns: 1 },
            { fieldname: 'delivery_date',                      columns: 1 },
            { fieldname: 'qty',                                columns: 1 },
            { fieldname: 'rate',                               columns: 1 },
            { fieldname: 'uom',                                columns: 1 },
            { fieldname: 'custom_distributed_discount_amount', columns: 1 },
            { fieldname: 'amount',                             columns: 1 },
        ];
    } else {
        // Reset to default columns for non-Export order types
        columns_to_show = [];
    }

    let value = {};
    value[grid.doctype] = columns_to_show;

    frappe.model.user_settings.save(frm.doctype, 'GridView', value).then((r) => {
        frappe.model.user_settings[frm.doctype] = r.message || r;
        grid.reset_grid();
        // Force all required columns visible at runtime (same pattern as Sales Invoice)
        [
            'sub_description',
            'gst_hsn_code',
            'delivery_date',
            'uom',
            'custom_distributed_discount_amount'
        ].forEach(fn => {
            grid.update_docfield_property(fn, 'hidden', 0);
            grid.update_docfield_property(fn, 'in_list_view', 1);
        });
        frm.refresh_field("custom_sub_items");
    });
}


/************************************
 * SHOW / HIDE EXPORT FIELDS (ITEMS)
 ************************************/
function toggle_export_fields(frm) {
    if (!frm.fields_dict.items) return;

    const is_export = frm.doc.order_type === "Export";

    let grid = frm.fields_dict.items.grid;
    let columns_to_show = [];

    if (is_export) {
        // Display columns for Export order type
        columns_to_show = [
            { fieldname: 'item_code', columns: 1 },
            { fieldname: 'description', columns: 2 },
            { fieldname: 'gst_hsn_code', columns: 1 },
            { fieldname: 'delivery_date', columns: 1 },
            { fieldname: 'qty', columns: 1 },
            { fieldname: 'rate', columns: 1 },
            { fieldname: 'uom', columns: 1 },
            { fieldname: 'distributed_discount_amount', columns: 1 },
            // { fieldname: 'discount_amount', columns: 1 },
            { fieldname: 'amount', columns: 1 },
        ];
    } else {
        // Reset to default columns for non-Export order types
        columns_to_show = [
            { fieldname: 'item_code', columns: 1 },
            { fieldname: 'description', columns: 2 },
            { fieldname: 'gst_hsn_code', columns: 1 },
            { fieldname: 'delivery_date', columns: 1 },
            { fieldname: 'qty', columns: 1 },
            { fieldname: 'rate', columns: 1 },
            { fieldname: 'uom', columns: 1 },
            { fieldname: 'distributed_discount_amount', columns: 1 },
            // { fieldname: 'discount_amount', columns: 1 },
            { fieldname: 'amount', columns: 1 },];
    }

    try {
        let value = {};
        value[grid.doctype] = columns_to_show;

        frappe.model.user_settings.save(frm.doctype, 'GridView', value).then((r) => {
            frappe.model.user_settings[frm.doctype] = r.message || r;
            grid.reset_grid();
            frm.refresh_field("items");
            hide_items_rows(frm);
        });

    } catch (e) {
        console.log("Error toggling export fields:", e);
    }
}

function update_sub_items_qty(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (!row.item_code || !row.custom_row_uid) return;

    const parent_qty = flt(row.qty) || 0;
    const uid = row.custom_row_uid;

    frappe.call({
        method: 'frappe.client.get',
        args: { doctype: 'Item', name: row.item_code },
        callback: function(r) {
            if (!r.message || !r.message.custom_sub_items || !r.message.custom_sub_items.length) return;

            // Build a base-qty map: sub_item_code → configured qty from Item master
            let base_qty_map = {};
            r.message.custom_sub_items.forEach(function(si) {
                base_qty_map[si.sub_item_code] = flt(si.qty) || 1;
            });

            // Update matching sub-items in the SO
            let updated = false;
            (frm.doc.custom_sub_items || []).forEach(function(sub) {
                if (sub.parent_row_uid !== uid) return;
                let base = base_qty_map[sub.sub_item_code] || flt(sub.qty) || 1;
                frappe.model.set_value('Sales Order Sub Item', sub.name, 'qty', parent_qty * base);
                updated = true;
            });

            if (updated) frm.refresh_field('custom_sub_items');
        }
    });
}


frappe.ui.form.on("Sales Order Item", {
    items_add(frm, cdt, cdn) {
        // Ensure visibility is set when new row is added
        setTimeout(() => {
            toggle_export_fields(frm);
        }, 100);
    },

    rate(frm, cdt, cdn) {
        calculate_cif_values(frm, cdt, cdn);
    },

    qty(frm, cdt, cdn) {
        calculate_cif_values(frm, cdt, cdn);
        update_sub_items_qty(frm, cdt, cdn);
    },

    custom_freight__insurance_(frm, cdt, cdn) {
        calculate_cif_values(frm, cdt, cdn);
    },

    item_code(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (row.item_code) {
            let old_uid = row.custom_row_uid;
            let new_uid = frappe.utils.get_random(8) + '_' + Date.now();
            frappe.model.set_value(cdt, cdn, 'custom_row_uid', new_uid);

            if (old_uid) {
                let existing_sub_items = frm.doc.custom_sub_items || [];
                frm.doc.custom_sub_items = existing_sub_items.filter(function(sub) {
                    return sub.parent_row_uid !== old_uid;
                });
            }

            frappe.call({
                method: 'frappe.client.get',
                args: {
                    doctype: 'Item',
                    name: row.item_code
                },
                callback: function(r) {
                    if (r.message && r.message.custom_sub_items && r.message.custom_sub_items.length > 0) {
                        r.message.custom_sub_items.forEach(function(sub_item) {
                            let sub_row = frm.add_child('custom_sub_items');
                            sub_row.parent_row_uid = new_uid;
                            sub_row.parent_item = row.item_code;
                            if (frm.fields_dict.custom_sub_items.grid.docfields.find(f => f.fieldname === 'parent_item_name')) {
                                sub_row.parent_item_name = row.item_name;
                            }
                            sub_row.sub_item_code = sub_item.sub_item_code;
                            sub_row.sub_item_name = sub_item.sub_item_name;
                            sub_row.sub_description = sub_item.sub_description;
                            sub_row.qty = sub_item.qty;
                        });

                        frm.refresh_field('custom_sub_items');
                        frappe.show_alert({
                            message: __('Sub-items populated for {0}', [row.item_code]),
                            indicator: 'green'
                        }, 3);
                    }
                }
            });
        } else {
            setTimeout(() => {
                calculate_cif_values(frm, cdt, cdn);
            }, 300);
        }
    },

    before_items_remove(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (row.custom_row_uid && frm.doc.custom_sub_items) {
            frm.doc.custom_sub_items = frm.doc.custom_sub_items.filter(function(sub) {
                return sub.parent_row_uid !== row.custom_row_uid;
            });
            frm.refresh_field('custom_sub_items');
        }
    }
});



frappe.ui.form.on("Sales Order Sub Item", {
    rate(frm, cdt, cdn) {
        calculate_sub_item_base_rate(frm, cdt, cdn);
        calculate_sub_item_cif_values(frm, cdt, cdn);
    },

    qty(frm, cdt, cdn) {
        calculate_sub_item_cif_values(frm, cdt, cdn);
    },

    custom_freight__insurance_(frm, cdt, cdn) {
        calculate_sub_item_cif_values(frm, cdt, cdn);
    }
});


/************************************
 * ROW-LEVEL CIF CALCULATION
 ************************************/
function calculate_cif_values(frm, cdt, cdn) {
    if (frm.doc.order_type !== "Export") return;

    let row = locals[cdt][cdn];

    // Skip CIF calculation for service items
    if (row.item_group === "Services") {
        frappe.model.set_value(cdt, cdn, "custom_cif_unit_price", 0);
        frappe.model.set_value(cdt, cdn, "custom__cif_total_amount", 0);
        frappe.model.set_value(cdt, cdn, "custom_cif_unit_price_", 0);
        frappe.model.set_value(cdt, cdn, "custom___cif_total_amount", 0);
        setTimeout(() => {
            calculate_so_cif_totals(frm);
        }, 100);
        return;
    }

    let base_rate = flt(row.base_rate); // company currency (INR)
    let rate = flt(row.rate);           // order currency
    let qty = flt(row.qty);
    let freight_pct = flt(row.custom_freight__insurance_);

    // Company currency CIF
    let cif_unit_company = base_rate + (base_rate * freight_pct / 100);
    let cif_total_company = cif_unit_company * qty;

    // Order currency CIF
    let cif_unit_currency = rate + (rate * freight_pct / 100);
    let cif_total_currency = cif_unit_currency * qty;

    frappe.model.set_value(cdt, cdn, "custom_cif_unit_price", cif_unit_company);
    frappe.model.set_value(cdt, cdn, "custom__cif_total_amount", cif_total_company);
    frappe.model.set_value(cdt, cdn, "custom_cif_unit_price_", (freight_pct && freight_pct > 0) ?  cif_unit_currency : 0);
    frappe.model.set_value(cdt, cdn, "custom___cif_total_amount", (freight_pct && freight_pct > 0) ?  cif_total_currency : 0);

    // Recalculate totals after updating row values
    setTimeout(() => {
        calculate_so_cif_totals(frm);
    }, 100);
}


/************************************
 * SUB-ITEM BASE RATE CALCULATION
 ************************************/
function calculate_sub_item_base_rate(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let rate = flt(row.rate);
    let conversion_rate = flt(frm.doc.conversion_rate);

    if (!conversion_rate) {
        conversion_rate = 1;
    }

    let base_rate = rate * conversion_rate;
    frappe.model.set_value(cdt, cdn, "base_rate", base_rate);
}


/************************************
 * SUB-ITEM ROW-LEVEL CIF CALCULATION
 ************************************/
function calculate_sub_item_cif_values(frm, cdt, cdn) {
    let row = locals[cdt] && locals[cdt][cdn];

    // Fallback: if row not in locals, find it in frm.doc
    if (!row) {
        row = frm.doc.custom_sub_items.find(r => r.name === cdn);
    }

    if (!row) return; // Exit if row still not found

    let base_rate = flt(row.base_rate);
    let rate = flt(row.rate);
    let qty = flt(row.qty);
    let freight_pct = flt(row.custom_freight__insurance_);

    // Calculate Amount (always)
    let amount = rate * qty;
    frappe.model.set_value(cdt, cdn, "amount", amount);

    // CIF calculations only for Export orders
    if (frm.doc.order_type !== "Export") return;

    // Company currency CIF
    let cif_unit_company = base_rate + (base_rate * freight_pct / 100);
    let cif_total_company = cif_unit_company * qty;

    // Order currency CIF
    let cif_unit_currency = rate + (rate * freight_pct / 100);
    let cif_total_currency = cif_unit_currency * qty;

    frappe.model.set_value(cdt, cdn, "custom_cif_unit_price", cif_unit_company);
    frappe.model.set_value(cdt, cdn, "custom__cif_total_amount", cif_total_company);
    frappe.model.set_value(cdt, cdn, "custom_cif_unit_price_", (freight_pct && freight_pct > 0) ? cif_unit_currency : 0);
    frappe.model.set_value(cdt, cdn, "custom___cif_total_amount", (freight_pct && freight_pct > 0) ? cif_total_currency : 0);
}


/************************************
 * SALES ORDER TOTAL CIF
 ************************************/
function calculate_so_cif_totals(frm) {
    if (frm.doc.order_type !== "Export") {
        // Clear totals if not export
        frm.set_value("custom_cif_total_amount_company_currency", 0);
        frm.set_value("custom_cif_total_amount_", 0);
        return;
    }

    let total_company = 0;
    let total_currency = 0;
    let total_item_amount = 0;

    (frm.doc.items || []).forEach(row => {
        // Skip Bank Charges item when calculating totals
        if (row.item_code === "Bank Charges") return;

        total_company += flt(row.custom__cif_total_amount);
        total_currency += flt(row.custom___cif_total_amount);
        total_item_amount += flt(row.amount);
    });

    frm.set_value(
        "custom_cif_total_amount_company_currency",
        total_company
    );

    frm.set_value(
        "custom_cif_total_amount_",
        total_currency
    );
    let conversion_rate = flt(frm.doc.conversion_rate) || 1;
    frm.set_value("custom_total_amount", total_item_amount);
    frm.set_value("custom_total_company_currency", total_item_amount * conversion_rate);
}



/************************************
 * ADD BANK CHARGES ITEM
 ************************************/
function add_bank_charges_item(frm) {
    if (frm.doc.order_type !== "Export") return;
    
    // Calculate CIF total and actual total (excluding Bank Charges)
    let cif_total_currency = 0;
    let actual_total_currency = 0;
    let existing_bank_charges_row = null;
    
    (frm.doc.items || []).forEach(row => {
        if (row.item_code === "Bank Charges") {
            existing_bank_charges_row = row;
            return;
        }
        cif_total_currency += flt(row.custom___cif_total_amount);
        actual_total_currency += flt(row.amount);
    });
    
    // Calculate the difference between CIF total and actual total
    let cif_difference = cif_total_currency - actual_total_currency;
    
    // Only proceed if there's a positive difference
    if (cif_difference <= 0) {
        // Remove Bank Charges if exists and no difference needed
        if (existing_bank_charges_row) {
            frm.doc.items = frm.doc.items.filter(row => row.item_code !== "Bank Charges");
        }
        return;
    }

    // If Bank Charges exists, update its rate
    if (existing_bank_charges_row) {
        existing_bank_charges_row.rate = cif_difference;
        existing_bank_charges_row.amount = cif_difference;
    } else {
        // Add new Bank Charges item at the end
        console.log("Adding Bank Charges item with amount:", cif_difference);
        let new_row = frm.add_child("items");
        new_row.item_code = "Bank Charges";
        new_row.item_name = "Bank Charges";
        new_row.description = "Bank Charges";
        new_row.item_group = "Services";
        new_row.uom = "Nos";
        new_row.stock_uom = "Nos";
        new_row.conversion_factor = 1;
        new_row.qty = 1;
        new_row.rate = cif_difference;
        new_row.amount = cif_difference;
        new_row.income_account = "Sales - GME";
        // Set CIF values to 0 for service item
        new_row.custom_cif_unit_price = 0;
        new_row.custom__cif_total_amount = 0;
        new_row.custom_cif_unit_price_ = 0;
        new_row.custom___cif_total_amount = 0;
    }
}