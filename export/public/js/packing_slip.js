/************************************
 * PACKING SLIP (PARENT)
 ************************************/
frappe.ui.form.on("Packing Slip", {
    refresh(frm) {
        toggle_export_fields(frm);
        toggle_cif_total_by_currency(frm);
        toggle_sub_items_columns(frm);
        hide_items_rows(frm);
        // recalculate_all_cubic_rows(frm);

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

        // frm.add_custom_button('Generate PDF', function () {
        //     frappe.call({
        //         method: "export.api.custom_print.generate_stamped_pdf",
        //         args: {
        //             doctype: frm.doc.doctype,
        //             name: frm.doc.name,
        //             print_formats: [
        //                 "PL Custom",
        //                 "PL Customer"
        //             ],
        //             letterhead: "GME_078_Global Mining_Inv._Customer"
        //         },
        //         callback: function (r) {
        //             if (r.message) {
        //                 frappe.show_alert({
        //                     message: __("Generated successfully."),
        //                     indicator: 'green'
        //                 }, 6);
        //             }
        //             cur_frm.reload_doc();
        //         }
        //     });
        // });
    },

    custom_order_type(frm) {
        toggle_export_fields(frm);
        toggle_sub_items_columns(frm);
        calculate_ps_cif_totals(frm);
    },

    custom_currency(frm) {
        toggle_cif_total_by_currency(frm);
        calculate_ps_cif_totals(frm);
    },

    validate(frm) {
        // Recalculate all sub-item values first
        // if (frm.doc.custom_sub_items) {
        //     frm.doc.custom_sub_items.forEach(row => {
        //         calculate_sub_item_cif_values(frm, 'Packing Slip Sub Items', row.name);
        //     });
        // }

        apply_parent_values_from_sub_items(frm);
        calculate_ps_cif_totals(frm);
        recalculate_all_cubic_rows(frm);

        hide_items_rows(frm);
    },

    onload_post_render(frm) {
        toggle_export_fields(frm);
        toggle_sub_items_columns(frm);

        set_currency(frm);

        carry_forward_sub_items(frm);
        hide_items_rows(frm);
        // recalculate_all_cubic_rows(frm);
    },

    delivery_note(frm) {
        carry_forward_sub_items(frm)
    }
});

/************************************
 * ITEMS GRID – CUSTOM TEMPLATE BUTTONS
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

    // CSS-first hide: prevents standard buttons from flashing on initial render.
    const $wrapper = $(grid.wrapper);
    if (!$wrapper.hasClass('ps-items-grid-custom')) {
        $wrapper.addClass('ps-items-grid-custom');
        if (!$('#ps-items-grid-custom-style').length) {
            $('<style id="ps-items-grid-custom-style">' +
              '.ps-items-grid-custom .grid-download,' +
              '.ps-items-grid-custom .grid-upload { display:none !important; }' +
              '</style>').appendTo('head');
        }
    }
    _hide_standard_items_template_buttons(frm);

    setTimeout(() => {
        _hide_standard_items_template_buttons(frm);

        const $footer = $wrapper.find('.grid-footer');

        // On submitted/To Bill docs Frappe hides .grid-footer.
        // Restore with display:flex so buttons appear right-aligned (same as standard).
        // Keep .grid-buttons (Add Row etc.) hidden since the doc is not editable.
        if ($footer.length && !$footer.is(':visible')) {
            $footer.css('display', 'flex');
            $footer.find('.grid-buttons').hide();
        }

        if ($wrapper.find('.custom-ps-template-btns').length) return;

        const $custom = $('<div class="custom-ps-template-btns flex gap-2"></div>');

        $custom.append(
            $('<button class="btn btn-xs btn-secondary">')
                .text(__('Download Template'))
                .on('click', () => {
                    const ps = (!frm.is_new() && frm.doc.name)
                        ? encodeURIComponent(frm.doc.name)
                        : '';
                    const url = frappe.urllib.get_full_url(
                        '/api/method/export.api.ps_items_template.get_ps_items_template'
                        + (ps ? `?packing_slip=${ps}` : '')
                    );
                    window.open(url, '_blank');
                })
        );

        $custom.append(
            $('<button class="btn btn-xs btn-secondary">')
                .text(__('Upload Template'))
                .on('click', () => {
                    if (frm.is_new()) {
                        frappe.msgprint(__('Please save the Packing Slip before uploading the template.'));
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
                    'Upload the filled template. ' +
                    'Row 1 = labels, Row 2 = fieldnames, Row 3+ = data. ' +
                    'Each row must have item_code.'
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
                method: 'export.api.ps_items_template.import_ps_items',
                args: {
                    packing_slip: frm.doc.name,
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

    // --- CSS-first hide: prevents standard buttons from ever flashing on initial render ---
    // The CSS rule applies to buttons added to the DOM after the rule is inserted,
    // so Frappe's .grid-download/.grid-upload are hidden the instant they render.
    const $wrapper = $(grid.wrapper);
    if (!$wrapper.hasClass('ps-sub-items-grid-custom')) {
        $wrapper.addClass('ps-sub-items-grid-custom');
        if (!$('#ps-sub-items-grid-custom-style').length) {
            $('<style id="ps-sub-items-grid-custom-style">' +
              '.ps-sub-items-grid-custom .grid-download,' +
              '.ps-sub-items-grid-custom .grid-upload { display:none !important; }' +
              '</style>').appendTo('head');
        }
    }
    // Also hide any already-rendered standard buttons immediately.
    _hide_standard_sub_items_template_buttons(frm);

    setTimeout(() => {
        _hide_standard_sub_items_template_buttons(frm);

        const $footer = $wrapper.find('.grid-footer');

        // On submitted/To Bill docs Frappe hides .grid-footer (display:none).
        // Restore it with display:flex so our buttons appear in the same right-aligned
        // position as the standard buttons. Keep .grid-buttons (Add Row etc.) hidden
        // since the doc is not editable.
        if ($footer.length && !$footer.is(':visible')) {
            $footer.css('display', 'flex');
            $footer.find('.grid-buttons').hide();
        }

        if ($wrapper.find('.custom-ps-sub-items-template-btns').length) return;

        const $custom = $('<div class="custom-ps-sub-items-template-btns flex gap-2"></div>');

        $custom.append(
            $('<button class="btn btn-xs btn-secondary">')
                .text(__('Download Sub Items Template'))
                .on('click', () => {
                    const ps = (!frm.is_new() && frm.doc.name)
                        ? encodeURIComponent(frm.doc.name)
                        : '';
                    const url = frappe.urllib.get_full_url(
                        '/api/method/export.api.ps_sub_items_template.get_ps_sub_items_template'
                        + (ps ? `?packing_slip=${ps}` : '')
                    );
                    window.open(url, '_blank');
                })
        );

        $custom.append(
            $('<button class="btn btn-xs btn-secondary">')
                .text(__('Upload Sub Items Template'))
                .on('click', () => {
                    if (frm.is_new()) {
                        frappe.msgprint(__('Please save the Packing Slip before uploading.'));
                        return;
                    }
                    show_sub_items_upload_dialog(frm);
                })
        );

        // Inject into the same right-side container as the standard buttons.
        // .grid-footer is now guaranteed visible (restored above if it was hidden).
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
                method: 'export.api.ps_sub_items_template.import_ps_sub_items',
                args: {
                    packing_slip: frm.doc.name,
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


function set_currency(frm) {
    if (frm.doc.docstatus !== 0) return;

    if (!frm.doc.delivery_note) return;

    // Skip if currency already set (existing document) — avoids making form dirty on open
    if (frm.doc.custom_currency) return;

    frappe.db.get_value("Delivery Note", frm.doc.delivery_note, "currency")
    .then(r => {

        if (!r.message) return;

        let currency = r.message.currency;

        frm.set_value("custom_currency", currency);

        (frm.doc.items || []).forEach(row => {
            frappe.model.set_value(row.doctype, row.name, "custom_currency", currency);
        });

        frm.refresh_field("items");

    });
}


function carry_forward_sub_items(frm) {
    if (frm.doc.docstatus !== 0 || !frm.is_new()) return;
    frm.clear_table("custom_sub_items");
    if (frm.doc.custom_sub_items && frm.doc.custom_sub_items.length > 0) return;

    let delivery_note_ref = frm.doc.delivery_note;
    if (!delivery_note_ref) return;

    // Item codes present in this PS — only carry sub items for matching parents
    let ps_item_codes = new Set((frm.doc.items || []).map(r => r.item_code).filter(Boolean));
    frappe.call({
        method: 'frappe.client.get',
        args: { doctype: 'Delivery Note', name: delivery_note_ref },
        callback: function(r) {
            if (!r.message || !r.message.custom_sub_items || !r.message.custom_sub_items.length) return;

            let carried = false;
            r.message.custom_sub_items.forEach(function(sub_item) {
                if (!ps_item_codes.has(sub_item.parent_item)) return;

                let new_sub = frm.add_child('custom_sub_items');
                new_sub.parent_row_uid           = sub_item.parent_row_uid;
                new_sub.parent_item              = sub_item.parent_item;
                new_sub.parent_item_name         = sub_item.parent_item_name;
                new_sub.sub_item_code            = sub_item.sub_item_code;
                new_sub.sub_item_name            = sub_item.sub_item_name;
                new_sub.sub_description          = sub_item.sub_description;
                new_sub.qty                      = sub_item.qty;
                new_sub.custom_net_weight        = sub_item.custom_net_weight;
                new_sub.custom_unit_weight       = sub_item.custom_unit_weight;
                new_sub.custom__gross_weight     = sub_item.custom_gross_weight;
                new_sub.custom_box               = sub_item.custom_box_no;
                new_sub.custom_length            = sub_item.custom_length_inch;
                new_sub.custom_width             = sub_item.custom_width_inch;
                new_sub.custom_height            = sub_item.custom_height_inch;
                new_sub.custom_cubic_feet        = sub_item.custom_vol_cuft;
                new_sub.custom_cubic_meter       = sub_item.custom_vol_cumtr;
                new_sub.custom_freight__insurance_ = sub_item.custom_freight__insurance_;
                frappe.model.set_value(new_sub.doctype, new_sub.name, "custom_currency", r.message.currency);
                // calculate_sub_item_cif_values(frm, "Packing Slip Sub Items", new_sub.name);
                carried = true;
            });
            if (carried) frm.refresh_field('custom_sub_items');
        }
    });
}


function apply_parent_values_from_sub_items(frm) {
    if (!frm.doc.items || !frm.doc.custom_sub_items) return;

    let sub_items = frm.doc.custom_sub_items || [];
    if (!sub_items.length) return;

    // Group sub-items by parent_row_uid (unique per parent row)
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
    if (!conversion_rate) conversion_rate = 1;

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
    frm.toggle_display("custom_cif_total_amount_", false);
}


function toggle_sub_items_columns(frm) {
    if (!frm.fields_dict.custom_sub_items) return;

    const is_export = frm.doc.custom_order_type === "Export";

    let grid = frm.fields_dict.custom_sub_items.grid;
    let columns_to_show = [];

    if (is_export) {
        // Display columns for Export order type
        columns_to_show = [
            { fieldname: 'parent_item', columns: 1 },
            { fieldname: 'sub_item_code', columns: 1 },
            { fieldname: 'qty', columns: 1 },
            { fieldname: 'custom_unit_weight', columns: 1 },
            { fieldname: 'custom__gross_weight', columns: 1 },
            { fieldname: 'custom_box', columns: 1 },
            { fieldname: 'custom_length', columns: 1 },
            { fieldname: 'custom_width', columns: 1 },
            { fieldname: 'custom_height', columns: 1 },
            { fieldname: 'custom_cubic_feet', columns: 1 },
            { fieldname: 'custom_cubic_meter', columns: 1 }
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
            frm.refresh_field("custom_sub_items");
        });


}

/************************************
 * HIDE Bank Charges (ITEMS)
 ************************************/

function hide_items_rows(frm) {
    const grid = frm.fields_dict?.items?.grid;
    if (!grid) return;

    const hide = () => {
        const rows = grid.grid_rows || [];
        if (!rows.length) return;

        rows.forEach((row) => {
            if (row?.doc?.item_code === "Bank Charges") {
                row.wrapper.hide();
            }
        });
    };

    setTimeout(hide, 0);
}


/************************************
 * SHOW / HIDE EXPORT FIELDS (ITEMS)
 ************************************/
function toggle_export_fields(frm) {
    if (!frm.fields_dict.items) return;

    const is_export = frm.doc.custom_order_type === "Export";

    let grid = frm.fields_dict.items.grid;
    let columns_to_show = [];

    if (is_export) {
        // Display columns for Export order type
        columns_to_show = [
            { fieldname: 'item_code', columns: 1 },
            { fieldname: 'qty', columns: 1 },
            { fieldname: 'custom_unit_weight', columns: 1 },
            { fieldname: 'custom__gross_weight', columns: 1 },
            { fieldname: 'custom_box', columns: 1 },
            { fieldname: 'custom_length', columns: 1 },
            { fieldname: 'custom_width', columns: 1 },
            { fieldname: 'custom_height', columns: 1 },
            { fieldname: 'custom_cubic_feet', columns: 1 },
            { fieldname: 'custom_cubic_meter', columns: 1 },
        ];
    } else {
        // Reset to default columns for non-Export order types
        columns_to_show = [
            { fieldname: 'item_code', columns: 1 },
            { fieldname: 'qty', columns: 1 },
            { fieldname: 'custom_unit_weight', columns: 1 },
            { fieldname: 'custom__gross_weight', columns: 1 },
            { fieldname: 'custom_box', columns: 1 },
            { fieldname: 'custom_length', columns: 1 },
            { fieldname: 'custom_width', columns: 1 },
            { fieldname: 'custom_height', columns: 1 },
            { fieldname: 'custom_cubic_feet', columns: 1 },
            { fieldname: 'custom_cubic_meter', columns: 1 },
        ];
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
                frappe.model.set_value('Packing Slip Sub Items', sub.name, 'qty', parent_qty * base);
                updated = true;
            });

            if (updated) frm.refresh_field('custom_sub_items');
        }
    });
}

frappe.ui.form.on("Packing Slip Item", {
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
            // Generate a unique ID for this parent row if it doesn't have one,
            // or regenerate if item_code changed (old sub-items need cleanup)
            let old_uid = row.custom_row_uid;
            let new_uid = frappe.utils.get_random(8) + '_' + Date.now();
            frappe.model.set_value(cdt, cdn, 'custom_row_uid', new_uid);

            // Remove any existing sub-items for the old UID of this row
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
                            // Only set parent_item_name if field exists
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
            // Recalculate when item changes
            setTimeout(() => {
                calculate_cif_values(frm, cdt, cdn);
            }, 300);
        }
    },

    before_items_remove(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (row.custom_row_uid && frm.doc.custom_sub_items) {
            // Remove only sub-items linked to this specific row's UID
            frm.doc.custom_sub_items = frm.doc.custom_sub_items.filter(function(sub) {
                return sub.parent_row_uid !== row.custom_row_uid;
            });
            frm.refresh_field('custom_sub_items');
        }
    },

    custom_length(frm, cdt, cdn) {
        calculate_cubic(frm, cdt, cdn);
    },

    custom_width(frm, cdt, cdn) {
        calculate_cubic(frm, cdt, cdn);
    },

    custom_height(frm, cdt, cdn) {
        calculate_cubic(frm, cdt, cdn);
    },

    form_render(frm) {
        hide_items_rows(frm);
    }
});



frappe.ui.form.on("Packing Slip Sub Items", {
    custom_length(frm, cdt, cdn) {
        calculate_cubic(frm, cdt, cdn);
    },

    custom_width(frm, cdt, cdn) {
        calculate_cubic(frm, cdt, cdn);
    },

    custom_height(frm, cdt, cdn) {
        calculate_cubic(frm, cdt, cdn);
    },
    // rate(frm, cdt, cdn) {
    //     calculate_sub_item_base_rate(frm, cdt, cdn);
    //     calculate_sub_item_cif_values(frm, cdt, cdn);
    // },

    // qty(frm, cdt, cdn) {
    //     calculate_sub_item_cif_values(frm, cdt, cdn);
    // },

    // custom_freight__insurance_(frm, cdt, cdn) {
    //     calculate_sub_item_cif_values(frm, cdt, cdn);
    // }
});


/************************************
 * CUBIC FEET / CUBIC METER CALCULATION
 ************************************/
function recalculate_all_cubic_rows(frm) {
    if (frm.doc.docstatus !== 0) return;
    (frm.doc.items || []).forEach(row => {
        calculate_cubic(frm, row.doctype, row.name);
    });
    (frm.doc.custom_sub_items || []).forEach(row => {
        calculate_cubic(frm, row.doctype, row.name);
    });
}

function calculate_cubic(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let l = flt(row.custom_length);
    let w = flt(row.custom_width);
    let h = flt(row.custom_height);

    let cubic_feet = 0.00058 * l * w * h;
    let cubic_meter = 0.0283 * cubic_feet;

    frappe.model.set_value(cdt, cdn, "custom_cubic_feet", cubic_feet);
    frappe.model.set_value(cdt, cdn, "custom_cubic_meter", cubic_meter);
}


/************************************
 * ROW-LEVEL CIF CALCULATION
 ************************************/
function calculate_cif_values(frm, cdt, cdn) {
    if (frm.doc.custom_order_type !== "Export") return;

    let row = locals[cdt][cdn];

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
    frappe.model.set_value(cdt, cdn, "custom_cif_unit_price_", cif_unit_currency);
    frappe.model.set_value(cdt, cdn, "custom___cif_total_amount", cif_total_currency);

    // Recalculate totals after updating row values
    setTimeout(() => {
        calculate_ps_cif_totals(frm);
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
    if (frm.doc.custom_order_type !== "Export") return;

    // Company currency CIF
    let cif_unit_company = base_rate + (base_rate * freight_pct / 100);
    let cif_total_company = cif_unit_company * qty;

    // Order currency CIF
    let cif_unit_currency = rate + (rate * freight_pct / 100);
    let cif_total_currency = cif_unit_currency * qty;

    frappe.model.set_value(cdt, cdn, "custom_cif_unit_price", cif_unit_company);
    frappe.model.set_value(cdt, cdn, "custom__cif_total_amount", cif_total_company);
    frappe.model.set_value(cdt, cdn, "custom_cif_unit_price_", cif_unit_currency);
    frappe.model.set_value(cdt, cdn, "custom___cif_total_amount", cif_total_currency);
}


/************************************
 * PACKING SLIP TOTAL CIF
 ************************************/
function calculate_ps_cif_totals(frm) {
    if (frm.doc.custom_order_type !== "Export") {
        // Clear totals if not export
        frm.set_value("custom_cif_total_amount_company_currency", 0);
        frm.set_value("custom_cif_total_amount_", 0);
        return;
    }

    let total_company = 0;
    let total_currency = 0;

    (frm.doc.items || []).forEach(row => {

        if (row.item_code === "Bank Charges") return;

        total_company += flt(row.custom__cif_total_amount);
        total_currency += flt(row.custom___cif_total_amount);
    });

    frm.set_value(
        "custom_cif_total_amount_company_currency",
        total_company
    );

    frm.set_value(
        "custom_cif_total_amount_",
        total_currency
    );
}


/* ===== OLD CODE (COMMENTED) =====

frappe.ui.form.on("Packing Slip", {
    refresh(frm) {
        toggle_export_custom_fields(frm);
    },

    custom_order_type(frm) {
        toggle_export_custom_fields(frm);
    },

    onload(frm) {
        toggle_export_custom_fields(frm);
    }
});


function toggle_export_custom_fields(frm) {
    if (!frm.fields_dict.items) {
        console.log("Items field not found");
        return;
    }

    const is_export = frm.doc.custom_order_type === "Export";
    console.log("Order Type:", frm.doc.custom_order_type, "Is Export:", is_export);

    const export_fields = [
        "custom__gross_weight",
        "custom_unit_weight",
        "custom_length",
        "custom_width",
        "custom_height",
        "custom_cubic_meter",
        "custom_cubic_feet",
        "custom_box",
        "custom_customer_part_number",
        "net_weight"
    ];

    // Method 1: Update the doctype meta
    export_fields.forEach(fieldname => {
        const meta = frappe.meta.get_docfield("Packing Slip Item", fieldname);
        if (meta) {
            meta.hidden = is_export ? 0 : 1;
            meta.in_list_view = is_export ? 1 : 0;
        }
    });

    // Method 2: Update grid properties
    const grid = frm.fields_dict.items.grid;
    export_fields.forEach(fieldname => {
        grid.update_docfield_property(fieldname, "hidden", is_export ? 0 : 1);
        grid.update_docfield_property(fieldname, "in_list_view", is_export ? 1 : 0);
    });

    // Method 3: Force complete grid refresh
    grid.reset_grid();
    frm.refresh_field("items");
}


frappe.ui.form.on("Packing Slip Item", {
    items_add(frm, cdt, cdn) {
        setTimeout(() => {
            toggle_export_custom_fields(frm);
        }, 100);
    }
});

===== END OLD CODE ===== */
