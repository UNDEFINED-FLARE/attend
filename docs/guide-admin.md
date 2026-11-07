# Guide for institution administrators

1. **Register.** Create an account, choose *Register an institution*, and wait for UniAttend to approve it.
   You can set everything up while it is pending; only attendance sessions wait for approval.
2. **Faculties & venues.** Add faculties, then departments. For each lecture venue, enter its centre
   coordinates (Google Maps: right-click the building → copy) and a radius of about half the building's width
   plus 15 m. For large or oddly shaped halls, paste a boundary of 4+ corner points instead.
3. **Modules.** Create each module with its code. Leave *Required attendance* blank to use the institution default.
4. **Lecturers.** Add each lecturer with staff number and the email they will sign up with. Then assign them
   to modules. They get access as soon as they sign up and confirm that email.
5. **Students.** Import a CSV with `student_number, full_name, email, module_code`. Use one row per student per
   module to enrol a student in several modules. Re-importing the same file is safe: nothing is duplicated.
   Rows with problems are skipped and listed by row number.
6. **Policy.** Under *Policy & branding*, set the required attendance %, the late threshold, whether typed codes are
   allowed, and the accept score. Set the student number format (e.g. `^[0-9]{8}$`) so imports catch typos.
7. **Oversight.** *Overview* shows live figures and the lowest-attendance modules; *Audit log* records every role
   change, correction, import and session.

Student data requests (access, correction, deletion) under POPIA come to you as the responsible party. Correct
records through the lecturer correction flow so the change is audited.
