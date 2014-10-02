var on, onSuper,
	http = require( "http" ),
	EventEmitter2 = require( "eventemitter2" ).EventEmitter2,
	exec = require( "child_process" ).exec,
	fs = require( "fs" ),
	querystring = require( "querystring" ),
	util = require( "util" ),
	yaml = require( "js-yaml" );

function Notifier() {
	var notifier = this;
	this.server = http.createServer(function( request, response ) {
		var data = "";
		request.setEncoding( "utf8" );
		request.on( "data", function( chunk ) {
			data += chunk;
		});
		request.on( "end", function() {
			try {
				if ( request.headers[ "content-type" ] === "application/x-www-form-urlencoded" ) {
					data = querystring.parse( data );
					data = data.payload;
				}
				data = JSON.parse( data );
			} catch( error ) {
				// Invalid data, stop processing
				response.writeHead( 400 );
				response.end();
				notifier.emit( "error", error );
				return;
			}

			// Accept the request and close the connection
			response.writeHead( 202 );
			response.end();

			notifier.process( data );
		});
	});

	EventEmitter2.call( this, {
		wildcard: true,
		delimiter: "/"
	});
}
util.inherits( Notifier, EventEmitter2 );

Notifier.prototype.listen = function() {
	this.server.listen.apply( this.server, arguments );
};

onSuper = Notifier.prototype.on;

Notifier.prototype.on = function( eventName, arrayOrFn ) {
	var commandsTpl, fn, events, self,
		notifier = this;

	// Handle .on(<object of events>)
	if ( arguments.length === 1 && typeof eventName === "object" ) {
		self = this;
		events = eventName;
		Object.keys( events ).forEach(function( eventName ) {
			self.on.apply( self, [ eventName, events[ eventName ] ] );
		});
		return;

	// Treat an Array as a list of shell commands to be executed
	} else if ( Array.isArray( arrayOrFn ) ) {
		commandsTpl = arrayOrFn.join( ";" );
		fn = function( data ) {
			var commands;
			try {
				commands = commandsTpl.replace( /{{([^}]+)}}/g, function( match, key ) {
					if ( !( key in data ) ) {
						throw new Error( "Could not replace `" + key + "` of `\"" + commandsTpl + "\"` on " +
							eventName + " " + JSON.stringify(data) );
					}
					return data[ key ];
				});
			} catch( error ) {
				notifier.emit( "error", error );
				return;
			}
			exec( commands, function( error, stdout, stderr ) {
				notifier.emit( "stdout", stdout );
				notifier.emit( "stderr", stderr );
				if ( error !== null ) {
					return notifier.emit( "error", error );
				}
			});
		};

	} else {
		fn = arrayOrFn;
	}

	return onSuper.apply( this, [ eventName, fn ] );
};

Notifier.prototype.process = function( raw ) {
	// { "zen": "Design for failure.", "hook_id": 123 }
	if ( raw.zen ) {
		return;
	}

	var refParts = raw.ref.split( "/" ),
		type = refParts[ 1 ],
		owner = raw.repository.owner.name,
		repo = raw.repository.name,
		data = {
			commit: raw.after,
			owner: owner,
			repo: repo,
			raw: raw
		},
		eventName = owner + "/" + repo + "/" + raw.ref.substr( 5 );

	if ( type === "heads" ) {
		// Handle namespaced branches
		data.branch = refParts.slice( 2 ).join( "/" );
	} else if ( type === "tags" ) {
		data.tag = refParts[ 2 ];
	}

	this.emit( eventName, data );
};

Notifier.prototype.shell = function() {

};

exports.Notifier = Notifier;
exports.createServer = function() {
	return new Notifier();
};
