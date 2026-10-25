# Address design — addendum to 2.47 geography

> **SR-0, 2026-10-25.** Written before any schema change, so the decisions are
> reviewable rather than archaeological.
>
> This supersedes nothing in 2.47. It extends the geography masters downward
> (a level below district) and sideways (a free-text place name, coordinates,
> and Google's own identifier), and it states what happens to rows that already
> exist.

---

## 1. The problem this solves

G40, open since 7A: `m_mdm_district` and `m_mdm_city` are **empty**. The
consequence is not cosmetic. A school in Hisar cannot say it is in Hisar, and a
teacher cannot search for Hisar, because nothing in the system knows the word.
The registration form hides the district and city controls entirely — correctly
(2.47's reachable-rows discipline), but it means the product's location story
today is **state only**.

G40 also says why the list was never invented: *half a list is worse than no
list*, because a visitor from a missing town reads the empty page as "no jobs
here" rather than "we do not know this town".

That argument holds. What changes is that we now have a client directive to
cover **Haryana completely**, from a named public source, which is not the same
as inventing a list from memory.

---

## 2. What the hierarchy becomes

```
Country
  └── State
        └── District
              └── Tehsil          ← NEW, optional
                    └── City / Village
```

Plus, on any row that carries an address:

```
AreaOrVillage   free text   — the locality, when no master row fits
Latitude        decimal     — where it actually is
Longitude       decimal
GooglePlaceId   varchar     — Google's stable identifier for the place
```

### 🔴 Why tehsil is a master and area is free text

A **tehsil** is an administrative unit. It is enumerable, it is stable, it is
published by the state, and two people naming the same tehsil will write the
same word. That is exactly what a master table is for.

An **area, mohalla, colony or village name** is none of those things. There is
no authoritative list, new colonies appear constantly, and the same place is
written five ways. A master table here would be a table we are permanently
behind on, and a dropdown that never contains what the user is looking for —
which is the "half a list" failure again, one level down.

So: tehsil is a row, area is a string. The string is never a filter the product
promises to match on; it is shown on the address and searched as text.

### ⚠️ Tehsil and city/village are BOTH optional

A school that knows only "Hisar district" must be able to finish registering.
Requiring tehsil would reproduce the exact problem this addendum exists to fix,
one level further down.

---

## 3. Schema changes

### 3.1 New master

```
m_mdm_tehsil
    TehsilId      int IDENTITY
    Code          varchar(30)   -- stable identifier (2.47)
    Name          nvarchar(300)
    DistrictId    int NOT NULL  -> m_mdm_district
    DisplayOrder  int
    + the standard Is_Active / Is_Deleted / audit columns
```

`Code` is the contract, per 2.47: FKs and seeds resolve by it, and it never
changes on a live row. `Name` is display text the client may edit freely.

### 3.2 City gains a tehsil, and keeps its district

```
m_mdm_city  +  TehsilId int NULL   -> m_mdm_tehsil
```

🔴 **`DistrictId` stays NOT NULL on the city, and is not replaced by the
tehsil.** It would be tempting to reach the district *through* the tehsil and
drop the column. Two reasons not to:

1. Tehsil is optional for a city. A city whose tehsil we do not know would then
   have no district either, and district is the level the product actually
   filters on.
2. Every existing read — the public job filters, the school address, the
   teacher's preferred locations — joins city to district today. Removing the
   column turns a data addition into a rewrite of working, tested code.

The cost is one denormalised column, and the rule that goes with it: **a city's
TehsilId, where present, must belong to that city's DistrictId.** Asserted by a
build guard, not by hope.

### 3.3 Address-bearing tables gain four columns

Measured — these are the tables that hold an address today:

| Table | Has today | Gains |
|---|---|---|
| `t_app_schools` | AddressLine1/2, City, District, State, Pincode | `TehsilId`, `AreaOrVillage`, `Latitude`, `Longitude`, `GooglePlaceId` |
| `t_app_school_branches` | the same **plus Latitude/Longitude** | `TehsilId`, `AreaOrVillage`, `GooglePlaceId` |
| `t_mdm_school_registration_details` | the registration's own copy | the same five |
| `t_app_teacher_preferred_locations` | City, State | `TehsilId` *(nullable, for later)* |

⚠️ `t_app_school_branches` **already has Latitude and Longitude** and has had
since 3C. They are unused. This addendum gives them their first consumer rather
than adding a second pair beside them.

### 3.4 `t_app_jobs` gains nothing

A job's location is its branch's location. Jobs carry `CityId`/`StateId` as a
denormalised copy for search; adding coordinates there would be a third place
the same fact lives. If map search ever needs job coordinates, they come from
the branch.

---

## 4. How an address gets entered

Two paths, and the product must work with either:

```
PRIMARY    Google Places autocomplete
           school types "Nalanda Vid…", picks from a list, we receive
           structured components + lat/long + PlaceId

FALLBACK   the manual cascade
           State → District → Tehsil (optional) → City/Village (optional)
           + AreaOrVillage free text
```

🔴 **Both paths must produce the SAME stored shape.** This is the whole design
constraint, and it is what SR-2's verification is built around: a row entered
by autocomplete and a row entered by hand must be indistinguishable afterwards,
apart from `GooglePlaceId` and the coordinates being present on one.

If they differ, the product has two kinds of address and every read has to know
which it is looking at — which is how a feature that "works" becomes a
permanent tax on everything written after it.

### What happens when Google returns a place we have no master row for

Google will return places our masters do not contain — a village in a state we
have not seeded, or a new colony. The resolution order:

1. Match the returned district/city against our masters by name, within the
   state we matched.
2. What matched, we store as an id. What did not, we store as text in
   `AreaOrVillage`, and keep the coordinates and the PlaceId.
3. **We never create a master row from a Google response.** Masters are
   reference data (2.47) and must stay reviewable; a table that grows itself
   from user input is a table nobody can audit.

So an unmatched place degrades to "state + coordinates + a name we show" — the
address is complete and honest, and the filters simply do not have a row to
match it to yet. That is a known, named limitation rather than silent bad data.

---

## 5. Migration — what happens to rows that already exist

Measured before writing this:

```
t_app_schools                      rows with CityId    : 0
t_app_school_branches              rows with CityId    : counted in SR-1
t_app_teacher_preferred_locations  rows                : counted in SR-1
```

Because `m_mdm_city` has always been empty, **no existing row can be pointing
at a city**, and therefore no existing row needs its city remapped. This is the
one and only piece of luck in G40 being open so long: there is no legacy
city data to migrate, because there was never any city data.

The migration is therefore:

1. All new columns are **nullable**. Every existing row stays valid, unchanged,
   the moment the column is added.
2. No backfill of `TehsilId`, `Latitude`, `Longitude` or `GooglePlaceId` — they
   are genuinely unknown for an existing row, and writing a guess into them
   would be worse than the NULL that honestly says "not captured".
3. `AreaOrVillage` likewise starts NULL. It is not derived from
   `AddressLine2`: those are different facts, and copying one into the other
   would invent data that nobody typed.
4. Existing registrations and schools continue to render with exactly the
   fields they have — asserted in SR-3, because "the matrix moves fields, never
   orphans data" is a promise that has to be checked, not stated.

⚠️ **Nothing becomes mandatory retrospectively.** If the client makes a field
compulsory, it is compulsory for *new* entries. A school approved in September
is not dragged back to fill a box, and the suites assert that its profile still
loads.

---

## 6. What this does NOT do

- It does not seed any state other than Haryana. Other states follow on the
  client's confirmation that Haryana is right, and the same source and method
  apply.
- It does not add map display, distance search or "jobs near me". The
  coordinates are stored so those become possible later; nothing reads them in
  this round except the address itself.
- It does not make Google Places a dependency. The switch exists, the fallback
  is a real path that is verified with the switch OFF, and the product is fully
  usable without a key.
