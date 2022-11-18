// https://nginx.org/en/docs/njs/reference.html#njs_global_functions

const fs = require('fs')

export default async function authenticate(r) {
    const token = fs.readFileSync('token').toString().trim()

    if (r.headersIn.hasOwnProperty('authorizationToken')) {
        if (r.headersIn.authorizationToken == token) {
            r.return(200);
        } else {
	    r.error("Invalid token");
            r.return(401, "invalid token");
        }
    } else {
	r.error("missing token");
        r.return(401, "missing token");
    }
}
