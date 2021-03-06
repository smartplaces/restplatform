var logger = require('./log');
var pass = require('./pass');
var restify = require('restify');
var _ = require('underscore');
var mongojs = require('mongojs');
var crypto = require('crypto');
var apn = require('apn');

var apnOptions = {
  cert: './keys/pass.ru.smartplaces.coupon.cert.pem',
  key: './keys/pass.ru.smartplaces.coupon.pkey.pem',
  production: true
};
var feedback = new apn.feedback(_.extend(apnOptions,{address:'feedback.push.apple.com'}));
feedback.on('feedback', console.log);
feedback.on('feedbackError', console.error);

var mongoConnection = 'mongodb://smartplaces:EvystVtcnf@oceanic.mongohq.com:10091/smartplaces'; // || process.env.MONGOHQ_URL || 'localhost:3001/smartplaces';
var db = mongojs(mongoConnection,['smartplaces']);
var passes = db.collection('passes');
var locations = db.collection('locations');
var scenarios = db.collection('scenarios');
var messages = db.collection('messages');

var http_port = process.env.PORT || '8080';



var http_server = restify.createServer({
  name:'SmartPlaces RESP API'
});

initServer(http_server);

http_server.listen(http_port,function(){
  logger.info('%s listening at %s',http_server.name,http_server.url);
});

function initServer(server){

  server.use(restify.acceptParser(server.acceptable));
  server.use(restify.authorizationParser());
  server.use(restify.dateParser());
  server.use(restify.queryParser());
  server.use(restify.jsonp());
  server.use(restify.gzipResponse());
  server.use(restify.bodyParser());


  server.get('/', restify.serveStatic({
	  'directory': '.',
	  'default': 'index.html'
  }));


  server.get({path:'/mobile/locations/:user_id?'},function (req,res,next){
    var userId = req.params.user_id;
    logger.info('Handling get locations for mobile app request: userId: [%s]',userId);

    var q = {userId : userId};
    if (userId == 'all'){
      q = {};
    }

    locations.find(q, function(err, docs){
      if (err){
        logger.error(err);
        res.send(500);
      }
      if (docs.length > 0){
        var result = [];
        _.each(docs,function(d){
          result.push(d);
        });

        if (result.length > 0){
          logger.info('Locations for mobile app request were found: ',result);
          res.send(200,result);
        }else{
          logger.info('Locations for mobile app request weren\'t found - 204.');
          res.send(204);
        }
      }else{
        logger.info('Locations for mobile app request not found - 404!');
        res.send(404);
      }
    });

  });

  server.get({path:'/mobile/message/:uuid/:major/:minor/:proximity'},function (req,res,next){
    var uuid = req.params.uuid;
    var major = req.params.major;
    var minor = req.params.minor;
    var proximity = req.params.proximity;
    logger.info('Handling get message for mobile app request: [%s]:[%s]:[%s] [%s], ',uuid, major, minor, proximity);

    var q = {
      beacons: {$elemMatch: {uuid: uuid, major: parseInt(major), minor: parseInt(minor)}}
    }

    var p = {
      title:1,
      address:1,
      contacts:1,
      lat:1,
      lng:1,
      "beacons.$":1
    }

    locations.findOne(q, p, function(err, location){
      if (err){
        logger.error(err);
        res.send(500);
      }
      if (location.beacons.length == 1){
        logger.info('Beacon for mobile app request was found: ',location);
        var tags = location.beacons[0].tags
        var proximities = ["IMMEDIATE"]
        switch (proximity){
          case "NEAR": proximities.push("NEAR"); break;
          case "FAR": proximities.push("NEAR") ; proximities.push("FAR"); break;
          default: break;
        }
        var qs = {
          active: true,
          beacons: {$in: tags},
          proximity: {$in: proximities},
          $and : [
            {$or: [{start: null},{start: {$exists:false}},{start:{$gte: new Date()}}]},
            {$or: [{end: null},{end: {$exists:false}},{end:{$gte: new Date()}}]}
          ]
        }

        scenarios.findOne(qs, function(err, scenario){
          if (err){
            logger.error(err);
            res.send(500);
          }
          if (scenario){
            logger.info('Scenario for mobile app request was found: ',scenario);
            messages.findOne({_id:scenario.message},function(err,message){
              if (err){
                logger.error(err);
                res.send(500);
              }
              if (message){
                message.location = location;
                message.frequency = scenario.frequency;

                if (message.image && message.image.url){
                  message.image.url = "https://secure-bastion-8859.herokuapp.com"+message.image.url;
                }

                if (scenario.coupon){
                  passes.findOne({_id:scenario.coupon},function(err,p){
                    if (err){
                      logger.error(err);
                      res.send(500);
                    }
                    if (p){
                      message.coupon='http://sleepy-scrubland-4869.herokuapp.com/passws/download/'+p.pass.passTypeIdentifier+'/'+p.pass.serialNumber+'/smartplaces.pkpass?hash=NONE';
                      logger.info('Message with coupon for mobile app request was found: ',message);
                      res.send(200,message);
                    }else{
                      logger.info('Coupon for message for mobile app request not found - 404!');
                      res.send(404);
                    }
                  });
                }else{
                  logger.info('Message for mobile app request was found: ',message);
                  res.send(200,message);
                }

              }else{
                logger.info('Message for mobile app request not found - 404!');
                res.send(404);
              }
            });
          }else{
            logger.info('Scenario for mobile app request not found - 404!');
            res.send(404);
          }
        });
      }else{
        logger.info('Beacon for mobile app request not found - 404!');
        res.send(404);
      }
    });

  });

  server.get({path:'/passws/notify/:pass_type_id/:serial_number?'},function (req,res,next){
    var passType = req.params.pass_type_id;
    var serialNumber = req.params.serial_number;
    var id = req.params.id;
    logger.info('Handling pass notification request: Id: [%s], Serial: [%s], Type: [%s]',id,serialNumber,passType);
    passes.findOne({_id:id},function(err,p){
      if (p && p.registrations){

        var apnConnection = new apn.Connection(_.extend(apnOptions,{address:'gateway.push.apple.com'}));
        _.each(p.registrations,function (r){
          logger.info('Pass notification request: send notification to device [%s]', r.pushToken);
          var device = new apn.Device(r.pushToken);
          var n = new apn.Notification();
          n.payload = {};
          apnConnection.pushNotification(n,device);
        });

        logger.info('Pass notification request: [%s] devices were notified.', p.registrations.length);
        res.send(200);
      }else{
        logger.info('Pass notification request: pass with id [%s] not found!', id);
        res.send(404);
      }
    });
  });

  server.get({path:'/passws/create/:pass_type_id/:serial_number?'},function(req,res,next){
    var passType = req.params.pass_type_id;
    var serialNumber = req.params.serial_number;
    var id = req.params.id;
    var hash = req.params.hash;
    logger.info('Handling pass creation request: Id: [%s], Serial: [%s], Type: [%s]',id,serialNumber,passType);
    passes.findOne({_id:id},function(err,p){
      if (p){
        var shasum = crypto.createHash('sha1');
        shasum.update(p._id+"/"+p.userId);
        if (hash && hash == shasum.digest('hex')){
          var json = pass.defaultJSON(serialNumber,passType);
          passes.update({_id:id},{$set:{pass:json}},{},function(error){
            if (error){
                logger.error(error);
                res.send(500);
              }
              logger.info('Pass creation request: pass with serial [%s] and type [%s] was created.',serialNumber,passType);
              res.send(200);
          });
        }else{
          res.send(401);
        }
      }else{
        res.send(404);
      }
    });
  });

  server.get({path:'/passws/download/:pass_type_id/:serial_number/:file_name?'},function (req, res, next){
    var passType = req.params.pass_type_id;
    var serialNumber = req.params.serial_number;
    var hash = req.params.hash;
    var sample = req.params.sample;

    if (sample){
      logger.info('Handling pass generation request: Sample, Serial: [%s], Type: [%s]',serialNumber,passType);
      pass.render(pass.defaultJSON(),null,res,function(error){
        if (error){
          logger.error(error);
          res.send(500);
        }
        logger.info('Pass generation request: Sample pass with serial [%s] and type [%s] was rendered.',serialNumber,passType);
        res.send(200);
      });
    }else{
      logger.info('Handling pass generation request: Serial: [%s], Type: [%s], Hash: [%s]',serialNumber,passType,hash);
      passes.findOne({'pass.passTypeIdentifier':passType,'pass.serialNumber':serialNumber}, function (err,p){
        if (p){
          pass.render(p.pass, p.images, res, function(error) {
            if (error){
              logger.error(error);
              res.send(500);
            }
            logger.info('Pass generation request: pass with serial [%s] and type [%s] was rendered.',serialNumber,passType);
            res.send(200);
          });
        }else{
          res.send(404);
        }
      });
    }
  });

  server.post({path:'/passws/v1/devices/:device_id/registrations/:pass_type_id/:serial_number'},function (req, res, next){
    var authToken = req.header('Authorization');
    if (authToken) authToken = authToken.replace('ApplePass ','');
    var serialNumber = req.params.serial_number;
    var passType = req.params.pass_type_id;
    var deviceId = req.params.device_id;
    var pushToken = req.params.pushToken;

    logger.info('Handling registration request: Auth: [%s], Serial: [%s], Type: [%s], Device: [%s], Push: [%s]',authToken, serialNumber, passType, deviceId, pushToken);

    passes.findOne({'pass.passTypeIdentifier':passType,'pass.serialNumber':serialNumber,'pass.authenticationToken':authToken}, function (err,pass){
      if (pass){
        if (_.indexOf(pass.registrations,deviceId) > -1){
          logger.info('Registration request: pass [%s] already registered for device [%s].',serialNumber, deviceId);
          res.send(200);
        }else{
          passes.update({_id:pass._id},{$addToSet:{registrations:{deviceId:deviceId,pushToken:pushToken}}},{},function(err){
            if (err){
              logger.info(err);
              res.send(500);
            }else{
              logger.info('Registration request: pass [%s] have been registered successfuly for device [%s]!', serialNumber, deviceId);
              res.send(201);
            }
          });
        }
      }else{
        logger.info('Registration request: pass [%s] with type [s%] and auth [%s] wasn\'t found!', serialNumber, passType, authToken);
        res.send(401);
      }
    });
  });

  server.get({path:'/passws/v1/devices/:device_id/registrations/:pass_type_id?'},function (req, res, next){
    var passType = req.params.pass_type_id;
    var deviceId = req.params.device_id;
    var passesUpdatedSince = req.params.passesUpdatedSince;

    logger.info('Handling updates request: UpdatedSince: [%s], Type: [%s], Device: [%s]', passesUpdatedSince, passType, deviceId);

    passes.find({'registrations.deviceId':deviceId},function(err,docs){
      if (docs.length>0){
        var result = {
          lastUpdated: ""+new Date().getTime(),
          serialNumbers: []
        }
        _.each(docs,function(d){
          if (d.pass.passTypeIdentifier === passType){
            if (passesUpdatedSince){
              if (!d.updatedAt || d.updatedAt > passesUpdatedSince){
                result.serialNumbers.push(d.pass.serialNumber);
              }
            }else{
              result.serialNumbers.push(d.pass.serialNumber);
            }
          }
        });

        if (result.serialNumbers.length > 0){
          logger.info('Updates request: updates for device [%s] were found: ', deviceId, result);
          res.send(200,result);
        }else{
          logger.info('Updates request: updates for device [%s] weren\'t found.');
          res.send(204);
        }
      }else{
        logger.info('Updates request: device [%s] not found!',deviceId);
        res.send(404);
      }
    });
  });

  server.del({path:'/passws/v1/devices/:device_id/registrations/:pass_type_id/:serial_number'},function (req, res, next){
    var authToken = req.header('Authorization');
    if (authToken) authToken = authToken.replace('ApplePass ','');
    var serialNumber = req.params.serial_number;
    var passType = req.params.pass_type_id;
    var deviceId = req.params.device_id;

    logger.info('Handling unregistration request: Auth: [%s], Serial: [%s], Type: [%s], Device: [%s]', authToken, serialNumber, passType, deviceId);

    passes.findOne({'pass.authenticationToken':authToken, 'pass.serialNumber':serialNumber, 'pass.passTypeIdentifier':passType, 'registrations.deviceId':deviceId},function(err,pass){
      if (pass){
        passes.update({_id:pass._id},{$pull:{registrations: {deviceId:deviceId}}},function(err){
          if (err){
            logger.info(err);
            res.send(500);
          }else{
            logger.info('Unregistration request: pass [%s] was successfuly unregistered for device [%s].',serialNumber,deviceId);
            res.send(200);
          }
        });
      }else{
        logger.info('Unregistration request: pass [%s] for device [%s] wasn\'t found.',serialNumber,deviceId);
        res.send(401);
      }
    });
   });

  server.get({path:'/passws/v1/passes/:pass_type_id/:serial_number'},function (req, res, next){
    var authToken = req.header('Authorization');
    var modifiedSince = req.header('If-Modified-Since');
    if (authToken) authToken = authToken.replace('ApplePass ','');
    var serialNumber = req.params.serial_number;
    var passType = req.params.pass_type_id;

    logger.info('Handling pass delivery request: Auth: [%s], Serial: [%s], Type: [%s], If-Modified-Since: [%s]', authToken, serialNumber, passType, modifiedSince);

    passes.findOne({'pass.authenticationToken':authToken,'pass.serialNumber':serialNumber,'pass.passTypeIdentifier':passType},function(err,p){
      if (p){
        if (modifiedSince && p.updatedAt){
          try{
            if (p.updatedAt < new Date(modifiedSince).getTime()){
              logger.info('Pass delivery request: pass does not modified since ',modifiedSince);
              res.send(304);
            }
          }catch(ex){
              logger.error(ex);
          }
        }
        res.header('Last-Modified', new Date());
        pass.render(p.pass, p.images, res, function(error) {
          if (error){
            logger.error(error);
            res.send(500);
          }
          logger.info('Pass delivery request: updates for pass [%s] was rendered.',serialNumber);
          res.send(200);
        });
      }else{
        logger.info('Pass delivery request: pass [%s] wasn\'t found.',serialNumber);
        res.send(401);
      }
    });
  });

  server.post({path:'passws/v1/log'},function (req, res, next){
    logger.info('Handling log request.');
    var logs = req.params.logs;
    _.each(logs,function(log){
      db.collection('passbook_logs').insert({ts: new Date().getTime(),m:log});
      logger.info('Log record added successuly: %s',log);
    });
    res.send(200);
  });
}
