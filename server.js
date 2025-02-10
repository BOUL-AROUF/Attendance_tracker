const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const session = require('express-session');
const pool = require('./db.js'); // Database connection
const router = express.Router();
const app = express();
const port = 3000;
const cron = require("node-cron");
const bcrypt = require('bcrypt');
const saltRounds = 10;

cron.schedule("59 23 * * *", () => {  // Runs at 23:59 (11:59 PM)
    fetch("http://localhost:3000/register-absentees", { method: "POST" })
        .then(response => response.json())
        .then(data => console.log("Auto Attendance Update:", data))
        .catch(error => console.error("Error auto-updating attendance:", error));
});

// Middleware
app.use(cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    secret: '3b0a88f3b8ac5fa469bf2b5d705d9830cfd72958e93d2d7c0a2f6ac4d5fbd556',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true }
}));
app.use(express.static(path.join(__dirname, 'src')));




// **Check Employee by ID**
app.post("/check-employee", (req, res) => {
    const { ID } = req.body;
    const sql = "SELECT * FROM employees WHERE ID = ?";
    pool.query(sql, [ID], (err, result) => {
        if (err) {
            console.error("Error fetching employee:", err);
            return res.status(500).json({ error: "Database error" });
        }
        if (result.length === 0) {
            return res.status(404).json({ error: "Employee not found" });
        }
        res.status(200).json(result[0]);
    });
});

//  **Get Employee Name by ID**
app.get("/get-employee-name/:id", (req, res) => {
    const { id } = req.params;
    const sql = "SELECT Name FROM employees WHERE ID = ?";
    pool.query(sql, [id], (err, result) => {
        if (err) {
            console.error("Error fetching employee name:", err);
            return res.status(500).json({ error: "Database error" });
        }
        if (result.length === 0) {
            return res.status(404).json({ error: "Employee not found" });
        }
        res.status(200).json({ name: result[0].Name });
    });
});

//  **Register Attendance**
app.post("/register-attendance", (req, res) => {
    const { ID, Name, Day, Status, Time } = req.body;
    const sql = "INSERT INTO attendance (ID, Employee, Day, Status, Time) VALUES (?, ?, ?, ?, ?)";
    pool.query(sql, [ID, Name, Day, Status, Time], (err, result) => {
        if (err) {
            console.error("Error inserting attendance:", err);
            return res.status(500).json({ error: "Failed to register attendance" });
        }
        res.status(200).json({ message: "Attendance registered successfully" });
    });
});


// **Get All Attendance Records**
app.get("/get-attendance", (req, res) => {
    // Log the entire query object and raw date
    console.log("Full query:", req.query);
    const { date } = req.query;
    console.log("Raw date received:", date);

    try {
        // Validate date format more explicitly
        if (!date) {
            console.log("No date provided");
            return res.status(400).json({ error: "Date parameter is required" });
        }

        // Try to parse and validate the date
        const parsedDate = new Date(date);
        if (isNaN(parsedDate.getTime())) {
            console.log("Invalid date format");
            return res.status(400).json({ error: "Invalid date format" });
        }

        // Format the date for MySQL query
        const formattedDate = parsedDate.toISOString().split('T')[0];
        console.log("Formatted date for query:", formattedDate);

        // SQL query to filter attendance by date
        const sql = "SELECT * FROM attendance WHERE DATE(Day) = ?";
        pool.query(sql, [formattedDate], (err, result) => {
            if (err) {
                console.error("Database error:", err);
                return res.status(500).json({ error: "Database error" });
            }
            console.log(`Found ${result.length} records for date ${formattedDate}`);
            res.status(200).json(result);
        });
    } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({ error: "Server error processing request" });
    }
});

// Define the route to fetch and display the report
app.get('/report-data', (req, res) => {
    const sql = 'SELECT * FROM report';  // Query to get the report data
    pool.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching data:', err);
            return res.status(500).send('Database query error');
        }
  
        console.log('Data fetched:', results);
        res.json(results);  // Send the results as a JSON response
    });
});


app.post('/check-attendance', (req, res) => {
    const todayDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const todayDay = new Date().toLocaleDateString('fr-FR', { weekday: 'long' }).toUpperCase(); // Get today in uppercase

    // Step 1: Get all employees
    pool.query('SELECT ID, Name, Repot FROM employees', (err, employees) => {
        if (err) {
            console.error("Error fetching employees:", err);
            return res.status(500).json({ error: `Failed to fetch employees: ${err.message}` });
        }

        if (employees.length === 0) {
            return res.status(404).json({ message: "No employees found." });
        }

        // Step 2: Process each employee
        const promises = employees.map(employee => {
            return new Promise((resolve, reject) => {
                // Step 3: Check if the employee already has any attendance record for today
                pool.query('SELECT * FROM attendance WHERE Employee = ? AND Day = ?', [employee.Name, todayDate], (err, existingRecord) => {
                    if (err) {
                        console.error("Error checking existing records:", err);
                        return reject(err);
                    }

                    // Step 4: If the employee already has an attendance record for today, check the status
                    if (existingRecord.length > 0) {
                        // If the employee is marked as "Present", skip the insertion of "Absent"
                        if (existingRecord.some(record => record.Status === 'Present')) {
                            console.log(`${employee.Name} (ID: ${employee.ID}) is already marked as Present for today. Skipping.`);
                            return resolve();
                        } else {
                            // If the employee is not "Present", proceed with marking "Absent" or "Day Off"
                            const currentTime = new Date().toLocaleTimeString('en-GB', { hour12: false });

                            // Step 5: If today is the employee's "Repot" (Day Off), insert "Day Off"
                            if (employee.Repot && employee.Repot.toUpperCase() === todayDay) {
                                pool.query('INSERT INTO attendance (ID, Employee, Day, Status, Time) VALUES (?, ?, ?, ?, ?)', 
                                    [employee.ID, employee.Name, todayDate, 'Day Off', null], 
                                    (err, result) => {
                                        if (err) {
                                            console.error("Error marking day off:", err);
                                            return reject(err);
                                        } else {
                                            console.log(`Marked ${employee.Name} (ID: ${employee.ID}) as "Day Off".`);
                                            return resolve();
                                        }
                                    });
                            } else {
                                // Mark as "Absent" if no "Present" or "Day Off" record exists
                                pool.query('INSERT INTO attendance (ID, Employee, Day, Status, Time) VALUES (?, ?, ?, ?, ?)', 
                                    [employee.ID, employee.Name, todayDate, 'Absent', currentTime], 
                                    (err, result) => {
                                        if (err) {
                                            console.error("Error marking absentee:", err);
                                            return reject(err);
                                        } else {
                                            console.log(`Marked ${employee.Name} (ID: ${employee.ID}) as Absent at ${currentTime}.`);
                                            return resolve();
                                        }
                                    });
                            }
                        }
                    } else {
                        // If no attendance record for the day, proceed to mark them as "Absent" or "Day Off"
                        const currentTime = new Date().toLocaleTimeString('en-GB', { hour12: false });

                        // Step 6: If today is the employee's "Repot" (Day Off), insert "Day Off"
                        if (employee.Repot && employee.Repot.toUpperCase() === todayDay) {
                            pool.query('INSERT INTO attendance (ID, Employee, Day, Status, Time) VALUES (?, ?, ?, ?, ?)', 
                                [employee.ID, employee.Name, todayDate, 'Day Off', null], 
                                (err, result) => {
                                    if (err) {
                                        console.error("Error marking day off:", err);
                                        return reject(err);
                                    } else {
                                        console.log(`Marked ${employee.Name} (ID: ${employee.ID}) as "Day Off".`);
                                        return resolve();
                                    }
                                });
                        } else {
                            // Mark as "Absent"
                            pool.query('INSERT INTO attendance (ID, Employee, Day, Status, Time) VALUES (?, ?, ?, ?, ?)', 
                                [employee.ID, employee.Name, todayDate, 'Absent', currentTime], 
                                (err, result) => {
                                    if (err) {
                                        console.error("Error marking absentee:", err);
                                        return reject(err);
                                    } else {
                                        console.log(`Marked ${employee.Name} (ID: ${employee.ID}) as Absent at ${currentTime}.`);
                                        return resolve();
                                    }
                                });
                        }
                    }
                });
            });
        });

        // Step 7: Wait for all queries to finish
        Promise.all(promises)
            .then(() => {
                res.status(200).json({ message: "Attendance processed. Absentees & Day Offs marked." });
            })
            .catch(err => {
                console.error("Error processing attendance:", err);
                res.status(500).json({ error: `Failed to process attendance: ${err.message}` });
            });
    });
});


// Function to fill and update the report table with employee data and attendance details
function updateReportForEmployee() {
    // Step 1: Fetch employee data from the 'employees' table
    const selectEmployeesQuery = 'SELECT Name, Salaire FROM employees';
    
    pool.query(selectEmployeesQuery, (err, employees) => {
        if (err) {
            console.error('Error fetching employees:', err);
            return;
        }

        // For each employee, we need to check if the record exists in the report table
        employees.forEach((employee) => {
            const { Name, Salaire } = employee;

            // Step 2: Check if employee exists in the 'report' table
            const checkEmployeeQuery = 'SELECT COUNT(*) AS count FROM report WHERE Employee = ?';
            
            pool.query(checkEmployeeQuery, [Name], (err, result) => {
                if (err) {
                    console.error(`Error checking existence of ${Name} in report:`, err);
                    return;
                }

                const exists = result[0].count > 0;

                // If the employee exists, we update the record
                if (exists) {
                    const updateReportQuery = `
                        UPDATE report
                        SET Salaire_de_reference = ?
                        WHERE Employee = ?;
                    `;

                    pool.query(updateReportQuery, [Salaire, Name], (err, result) => {
                        if (err) {
                            console.error(`Error updating report for ${Name}:`, err);
                            return;
                        }

                        console.log(`Successfully updated salary reference for ${Name}`);

                        // Step 3: Calculate days of presence, absence, and day off from the attendance table
                        // Modified to include date range if needed
                        const calculateAttendanceQuery = `
                            SELECT 
                                Employee,
                                SUM(CASE WHEN Status = 'Present' THEN 1 ELSE 0 END) AS Jours_Presence,
                                SUM(CASE WHEN Status = 'Absent' THEN 1 ELSE 0 END) AS Jours_Absence,
                                SUM(CASE WHEN Status = 'Day Off' THEN 1 ELSE 0 END) AS Jours_Off,
                                COUNT(*) AS Total_Days_In_Period
                            FROM attendance
                            WHERE Employee = ?
                            GROUP BY Employee;
                        `;

                        pool.query(calculateAttendanceQuery, [Name], (err, results) => {
                            if (err) {
                                console.error(`Error calculating attendance for ${Name}:`, err);
                                return;
                            }

                            if (results.length > 0) {
                                const { 
                                    Jours_Presence, 
                                    Jours_Absence, 
                                    Jours_Off,
                                    Total_Days_In_Period 
                                } = results[0];

                                // Calculate Total_de_jours (now includes all working days)
                                const Total_de_jours = Total_Days_In_Period;

                                // Calculate Salaire_Payent based on actual working days
                                const dailySalary = parseFloat(Salaire) / 30; // Assuming 30 days per month
                                const Salaire_Payent = (
                                    parseFloat(Salaire) - (dailySalary * Jours_Absence)
                                ).toFixed(2);

                                // Step 4: Update the report table with the calculated attendance data
                                const updateAttendanceQuery = `
                                    UPDATE report
                                    SET 
                                        Jours_Presence = ?, 
                                        Jours_Absence = ?, 
                                        Jours_Off = ?, 
                                        Total_de_jours = ?, 
                                        Salaire_Payent = ?
                                    WHERE Employee = ?;
                                `;

                                pool.query(updateAttendanceQuery, 
                                    [Jours_Presence, Jours_Absence, Jours_Off, Total_de_jours, Salaire_Payent, Name], 
                                    (err, result) => {
                                        if (err) {
                                            console.error(`Error updating attendance data for ${Name}:`, err);
                                        } else {
                                            console.log(`Updated attendance data for ${Name} in the report.`);
                                        }
                                    }
                                );
                            } else {
                                console.log(`No attendance records found for ${Name}`);
                            }
                        });
                    });
                } else {
                    // Insert logic remains the same but with updated calculations
                    const insertReportQuery = `
                        INSERT INTO report (Employee, Salaire_de_reference)
                        VALUES (?, ?);
                    `;

                    pool.query(insertReportQuery, [Name, Salaire], (err, result) => {
                        if (err) {
                            console.error(`Error inserting record for ${Name}:`, err);
                            return;
                        }

                        console.log(`Successfully inserted new record for ${Name}`);

                        // Use the same updated calculation logic as above
                        const calculateAttendanceQuery = `
                            SELECT 
                                Employee,
                                SUM(CASE WHEN Status = 'Present' THEN 1 ELSE 0 END) AS Jours_Presence,
                                SUM(CASE WHEN Status = 'Absent' THEN 1 ELSE 0 END) AS Jours_Absence,
                                SUM(CASE WHEN Status = 'Day Off' THEN 1 ELSE 0 END) AS Jours_Off,
                                COUNT(*) AS Total_Days_In_Period
                            FROM attendance
                            WHERE Employee = ?
                            GROUP BY Employee;
                        `;

                        // Rest of the insert logic follows the same pattern as the update logic above
                        // ... (same calculation and query logic as in the update section)
                    });
                }
            });
        });
    });
}

// Call the function to update the report for all employees
updateReportForEmployee();


// Route to fetch total salary, presence, and absence
app.get('/getTotals', (req, res) => {
    const query = `
        SELECT 
            SUM(Salaire_Payent) AS TotalSalaire,
            SUM(Jours_Presence) AS TotalPresence,
            SUM(Jours_Absence) AS TotalAbsence
        FROM report;
    `;

    pool.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching totals:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (results.length > 0) {
            res.json(results[0]);  // Send totals as JSON response
        } else {
            res.json({ TotalSalaire: 0, TotalPresence: 0, TotalAbsence: 0 });
        }
    });
});

// **Get All Employees**
app.get('/employees', (req, res) => {
    pool.query(
        "SELECT ID, Name, Phone, Position, Salaire, DATE_FORMAT(Start_date, '%d.%m.%Y') AS Start_date, Repot FROM employees",
        (err, results) => {
            if (err) {
                console.error("Error fetching employees:", err);
                return res.status(500).json({ error: "Error fetching employees" });
            }
            res.json(results);
        }
    );
});


// Get Employee by ID (For Editing)
app.get('/employees/:id', (req, res) => {
    const { id } = req.params;
    pool.query('SELECT * FROM employees WHERE ID = ?', [id], (error, results) => {
        if (error) {
            console.error('Error fetching employee:', error);
            return res.status(500).json({ error: 'Database error' });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        res.json(results[0]);
    });
});

// Add a New Employee
app.post('/employees', (req, res) => {
    const { ID, Name, Position, Salaire, Phone, DateJ, DayOff } = req.body;

    // Check if the ID is provided
    if (!ID) {
        return res.status(400).json({ error: 'Employee ID is required' });
    }

    // First, check if the employee with the same ID already exists
    pool.query('SELECT * FROM employees WHERE ID = ?', [ID], (error, results) => {
        if (error) {
            console.error('Error checking employee existence:', error);
            return res.status(500).json({ error: 'Database error' });
        }

        if (results.length > 0) {
            // If the employee exists, update the existing record
            const sql = `UPDATE employees 
                         SET Name = ?, Phone = ?, Position = ?, Salaire = ?, Start_Date = ?, Repot = ? 
                         WHERE ID = ?`;

            pool.query(sql, [Name, Phone, Position, Salaire, DateJ, DayOff, ID], (error, results) => {
                if (error) {
                    console.error('Error updating employee:', error);
                    return res.status(500).json({ error: 'Database error' });
                }
                res.json({ id: ID, message: 'Employee updated successfully' });
            });
        } else {
            // If the employee does not exist, insert a new record
            const sql = `INSERT INTO employees (ID, Name, Phone, Position, Salaire, Start_Date, Repot) 
                         VALUES (?, ?, ?, ?, ?, ?, ?)`;

            pool.query(sql, [ID, Name, Phone, Position, Salaire, DateJ, DayOff], (error, results) => {
                if (error) {
                    console.error('Error adding employee:', error);
                    return res.status(500).json({ error: 'Database error' });
                }
                res.json({ id: ID, message: 'Employee added successfully' });
            });
        }
    });
});



// **Delete Employee and related records in Attendance and Report tables**
app.delete('/employees/:id', (req, res) => {
    const { id } = req.params;

    // First, fetch the employee's name using their ID
    pool.query('SELECT Name FROM employees WHERE ID = ?', [id], (error, results) => {
        if (error) {
            console.error('Error fetching employee name:', error);
            return res.status(500).json({ error: 'Error fetching employee name' });
        }

        if (results.length === 0) {
            // Employee not found
            return res.status(404).json({ error: 'Employee not found' });
        }

        const employeeName = results[0].Name; // Get the employee's name

        // Step 1: Delete employee-related attendance records using the employee's ID
        pool.query('DELETE FROM attendance WHERE ID = ?', [id], (error, results) => {
            if (error) {
                console.error('Error deleting attendance records:', error);
                return res.status(500).json({ error: 'Error deleting attendance records' });
            }

            // Step 2: Delete employee-related report records using the employee's name
            pool.query('DELETE FROM report WHERE Employee = ?', [employeeName], (error, results) => {
                if (error) {
                    console.error('Error deleting report records:', error);
                    return res.status(500).json({ error: 'Error deleting report records' });
                }

                // Step 3: Finally, delete the employee from the employees table
                pool.query('DELETE FROM employees WHERE ID = ?', [id], (error, results) => {
                    if (error) {
                        console.error('Error deleting employee:', error);
                        return res.status(500).json({ error: 'Error deleting employee' });
                    }
                    res.json({ message: 'Employee and related records deleted successfully' });
                });
            });
        });
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    const query = 'SELECT password, id FROM login_Attendance WHERE Username = ?';
    
    pool.query(query, [username], async (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to login.' });
        }
        
        if (results.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const user = results[0];
        
        // For the admin user (SHA-256)
        if (username === 'admin') {
            const crypto = require('crypto');
            const hashedPassword = crypto
                .createHash('sha256')
                .update(password)
                .digest('hex');
                
            if (hashedPassword === user.password) {
                req.session.userId = user.id;
                return res.status(200).json({ message: 'Login successful!' });
            }
        } 
        // For other users (plain text comparison)
        else if (password === user.password) {
            req.session.userId = user.id;
            return res.status(200).json({ message: 'Login successful!' });
        }
        
        res.status(400).json({ error: 'Invalid password.' });
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    const query = 'SELECT password, id FROM login_Attendance WHERE Username = ?';
    
    pool.query(query, [username], async (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to login.' });
        }
        
        if (results.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const user = results[0];
        
        // For the admin user (SHA-256)
        if (username === 'admin') {
            const crypto = require('crypto');
            const hashedPassword = crypto
                .createHash('sha256')
                .update(password)
                .digest('hex');
                
            if (hashedPassword === user.password) {
                req.session.userId = user.id;
                return res.status(200).json({ message: 'Login successful!' });
            }
        } 
        // For other users (plain text comparison)
        else if (password === user.password) {
            req.session.userId = user.id;
            return res.status(200).json({ message: 'Login successful!' });
        }
        
        res.status(400).json({ error: 'Invalid password.' });
    });
});


// Endpoint for Total Employees
app.get('/total-employees', (req, res) => {
    pool.query('SELECT COUNT(*) AS total FROM employees', (err, results) => {
        if (err) {
            console.error('Error fetching total employees:', err); // Log the error to the console
            res.status(500).json({ message: 'Error fetching total employees' });
        } else {
            res.json(results[0].total || 0); // Ensure 0 if no records are found
        }
    });
});

// Endpoint for Total Presents
app.get('/total-presents', (req, res) => {
    pool.query('SELECT COUNT(*) AS total FROM attendance WHERE Status = "Present"', (err, results) => {
        if (err) {
            console.error('Error fetching total presents:', err); // Log the error to the console
            res.status(500).json({ message: 'Error fetching total presents' });
        } else {
            res.json(results[0].total || 0); // Ensure 0 if no records are found
        }
    });
});

// Endpoint for Total Repot (Day Off)
app.get('/total-repot', (req, res) => {
    pool.query('SELECT COUNT(*) AS total FROM attendance WHERE Status = "Day Off"', (err, results) => {
        if (err) {
            console.error('Error fetching total repot:', err); // Log the error to the console
            res.status(500).json({ message: 'Error fetching total repot' });
        } else {
            res.json(results[0].total || 0); // Ensure 0 if no records are found
        }
    });
});

// **Start Server**
app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on http://localhost:${port}`);
});
