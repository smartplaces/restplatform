var logger = require('./log');
var restify = require('restify');
var _ = require('underscore');
var fs = require('fs');
var mongojs = require('mongojs');
var createTemplate = require("passbook");
var crypto = require('crypto');


var mongoConnection = 'mongodb://smartplaces:EvystVtcnf@oceanic.mongohq.com:10091/smartplaces'; // || process.env.MONGOHQ_URL || 'localhost:3001/smartplaces';
var db = mongojs(mongoConnection,['smartplaces']);
var passes = db.collection('passes');

var http_port = process.env.PORT || '8080';

var KEYS_FOLDER = "./keys/";
var KEYS_PASSWORD = "123456";
var IMAGE_FOLDER = "./images"

var http_server = restify.createServer({
  name:'SmartPlaces RESP API'
});

initServer(http_server);

http_server.listen(http_port,function(){
  logger.info('%s listening at %s',http_server.name,http_server.url);
});

function samplePassJSON(){
  shasum = crypto.createHash('sha1');
  shasum.update("SHA"+Math.random());

  return {
    formatVersion: 1,
    passTypeIdentifier: "pass.ru.smartplaces.coupon",
    teamIdentifier:     "Y77QB88576",
    webServiceURL: "https://sleepy-scrubland-4869.herokuapp.com/passws/",
    authenticationToken: ""+shasum.digest('hex'),
    organizationName: "SmartPlaces",
    description:   "Купон от SmartPlaces",
    backgroundColor:   "rgb(237,216,216)",
    foregroundColor: "rgb(247,7,65)",
    labelColor: "rgb(13,21,237)",

    serialNumber:  "SN"+new Date().getTime(),

    logoText: "Smar Coffe",

    barcode : {
      message : "1234567",
      format : "PKBarcodeFormatPDF417",
      messageEncoding : "utf-8"
    },

    beacons:[
      {
        proximityUUID:"E2C56DB5-DFFB-48D2-B060-D0F5A71096E0",
        major:1,
        minor:1,
        relevantText:"Hi, SmartPlace is near!"
      }
    ],

    coupon: {
      primaryFields : [
        {
          key : "offer",
          label : "на американо",
          value : "-50%"
        }
      ],
      secondaryFields : [
        {
          key : "addInfo",
          label : "Предложение для",
          value : "Всех посетителей"
        }
      ],
      backFields : [
        {
          "key" : "terms",
          "label" : "УСЛОВИЯ ИСПОЛЬЗОВАНИЯ",
          "value" : "Это купон создан компанией SmartPlaces и является ее собственностью."
        }
      ]
    }
  };
}

function preparePass(json,store){
  var template = createTemplate("coupon", {passTypeIdentifier:json.passTypeIdentifier, teamIdentifier:json.teamIdentifier});

  template.keys(KEYS_FOLDER, KEYS_PASSWORD);

  var pass = template.createPass(_.omit(json,'passTypeIdentifier','teamIdentifier'));

  pass.loadImagesFrom(IMAGE_FOLDER);

  pass.on("error", function(error) {
    logger.error(error);
  });

  if (store){
    logger.info('Pass generation request: new pass with serial [%s] have been stored.',json.serialNumber);
    passes.save({pass:json});
  }
  return pass;
}

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

  server.get({path:'/passws/getSamplePass/:pass_name'},function (req, res, next){
    logger.info('Handling pass generation request.');
    var json = samplePassJSON();
    var pass = preparePass(json,true);
    pass.render(res, function(error) {
      if (error){
        logger.error(error);
        res.send(500);
      }
      logger.info('Pass generation request: new pass with serial [%s] have been created.',json.serialNumber);
      res.send(200);
    });
  });

  server.get({path:'/passws/download/:id'},function (req, res, next){
    var id = req.params.id;
    logger.info('Handling pass generation request: Id: [%s]',id);
    passes.findOne({_id:id}, function (err,p){
      if (p){
        var pass = preparePass(p.pass,false);
        pass.render(res, function(error) {
          if (error){
            logger.error(error);
            res.send(500);
          }
          logger.info('Pass generation request: pass [%s] was rendered.',id);
          res.send(200);
        });
      }else{
        res.send(404);
      }
    });
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
    if (authToken) authToken = authToken.replace('ApplePass ','');
    var serialNumber = req.params.serial_number;
    var passType = req.params.pass_type_id;

    logger.info('Handling pass delivery request: Auth: [%s], Serial: [%s], Type: [%s]', authToken, serialNumber, passType);

    passes.findOne({'pass.authenticationToken':authToken,'pass.serialNumber':serialNumber,'pass.passTypeIdentifier':passType},function(err,p){
      if (p){
        //Next line added only for test purpose
        p.pass.coupon.primaryFields[0].value="-"+Math.floor(Math.random()*100)+"%";
        var pass = preparePass(p.pass,false);
        res.header('Last-Modified', new Date());
        pass.render(res, function(error) {
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
