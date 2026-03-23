// Assume the previous content is included here, with the necessary modifications made to the HTML rendering logic.
// Here is a modified version of the relevant part of the script.js file: 

// Replace this portion of the script with the new rendering logic
function renderScheduledQueue() {
    // Fetch and iterate over your data
    data.forEach(item => {
        // Replace existing columns to remove "Open" and "Action"
        let row = ` <tr>` + 
                   ` <td>${item.column1}</td>` + 
                   ` <td>${item.column2}</td>` + 
                   ` <td>${item.column3}</td>` + 
                   ` <td>${item.column4}</td>` + 
                   ` <td>${item.column5}</td>` + 
                   ` <td>${item.column6}</td>` + 
                   ` <td>${item.column7}</td>` + 
                   ` <td>${item.column8}</td>`; + 
                   ` <td class='row-actions'>` + 
                   ` <button class='open-link'>Open</button>` + 
                   `</td>` + 
                   ` </tr>`;
        // Append the row to the scheduled queue table
        document.getElementById('scheduled-queue-table').append(row);
    });
}
// Ensure that other parts of your code are compatible with this change and test it thoroughly.