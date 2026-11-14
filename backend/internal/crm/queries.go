package crm

import (
	"database/sql"
	"encoding/json"

	"creatoros/internal/model"
)

func ListBrands(db *sql.DB) ([]model.Brand, error) {
	rows, err := db.Query(`SELECT id, name, category, website, notes, created_at FROM brands ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Brand{}
	for rows.Next() {
		var b model.Brand
		if err := rows.Scan(&b.ID, &b.Name, &b.Category, &b.Website, &b.Notes, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func ListContacts(db *sql.DB) ([]model.Contact, error) {
	rows, err := db.Query(`SELECT id, brand_id, name, role, channel, handle, is_primary FROM brand_contacts ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Contact{}
	for rows.Next() {
		var c model.Contact
		if err := rows.Scan(&c.ID, &c.BrandID, &c.Name, &c.Role, &c.Channel, &c.Handle, &c.IsPrimary); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

const dealCols = `id, brand_id, title, stage, value, currency, deliverables, created_at, posted_at, closed_at`

type scanner interface{ Scan(...any) error }

func scanDeal(r scanner) (model.Deal, error) {
	var d model.Deal
	var raw string
	if err := r.Scan(&d.ID, &d.BrandID, &d.Title, &d.Stage, &d.Value, &d.Currency, &raw, &d.CreatedAt, &d.PostedAt, &d.ClosedAt); err != nil {
		return d, err
	}
	_ = json.Unmarshal([]byte(raw), &d.Deliverables)
	d.Deliverables = model.Strings(d.Deliverables)
	return d, nil
}

func ListDeals(db *sql.DB) ([]model.Deal, error) {
	rows, err := db.Query(`SELECT ` + dealCols + ` FROM deals ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Deal{}
	for rows.Next() {
		d, err := scanDeal(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// GetDeal returns nil when there is no such deal.
func GetDeal(q interface {
	QueryRow(string, ...any) *sql.Row
}, id int) (*model.Deal, error) {
	d, err := scanDeal(q.QueryRow(`SELECT `+dealCols+` FROM deals WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}
