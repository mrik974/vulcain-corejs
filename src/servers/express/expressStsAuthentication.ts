import { System } from '../../configurations/globals/system';
import { DefaultServiceNames } from '../../di/annotations';
import { ITokenService } from '../../defaults/services';
import { RequestContext, UserContext } from '../requestContext';
import { AbstractExpressAuthentication } from './abstractExpressAuthentication';
import { ConfigurationProperty } from '../../configurations/dependencies/annotations';
import { Conventions } from '../../utils/conventions';
import { IDynamicProperty } from '../../configurations/dynamicProperty';

const unirest = require('unirest');

@ConfigurationProperty(Conventions.instance.TOKEN_STS_AUTHORITY, "string")
export class ExpressStsAuthentication extends AbstractExpressAuthentication {
    private authority: IDynamicProperty<string>;
    private userInfoEndpoint: string;

    constructor() {
        super();
        this.authority = System.createSharedConfigurationProperty<string>(Conventions.instance.TOKEN_STS_AUTHORITY, 'http://localhost:5100');

        this.addOrReplaceStrategy('bearer', this.bearerAuthentication.bind(this));
    }

    private ensureUserInfoEndpointLoaded() {
        return new Promise<boolean>((resolve, reject) => {
            if (this.userInfoEndpoint) {
                resolve(true);
            } else {
                const openIdConfigUrl = `${this.authority.value}/.well-known/openid-configuration`;
                unirest.get(openIdConfigUrl).as.json(res => {
                    if (res.status >= 400) {
                        reject(res);
                    } else {
                        this.userInfoEndpoint = res.body.userinfo_endpoint;
                        resolve(true);
                    }
                });
            }
        });
    }

    private async getUserInfoAsync(accessToken: string) {
        await this.ensureUserInfoEndpointLoaded();

        return new Promise<any>((resolve, reject) => {
            unirest.get(this.userInfoEndpoint).headers({ authorization: `Bearer ${accessToken}`}).as.json(res => {
                if (res.status >= 400) {
                    reject(res);
                } else {
                    resolve(res.body);
                }
            });

        });
    }

    private async bearerAuthentication(ctx: RequestContext, accessToken: string) {
        try {
            let tokens = ctx.container.get<ITokenService>(DefaultServiceNames.TokenService);
            let token = await tokens.verifyTokenAsync({ token: accessToken, tenant: ctx.tenant });

            // No token found
            if (!token) {
                System.log.info(ctx, ()=> "Bearer authentication: Invalid jwtToken : " + accessToken);
                return null;
            }

            // get user info from STS
            let user = await this.getUserInfoAsync(accessToken);
            user.scopes = token.scope;

            System.log.info(ctx, ()=> JSON.stringify( user ));

            return user; // Return the current user with its scopes and tenant
        }
        catch (err) {
            System.log.error(ctx, err, ()=> "Bearer authentication: Error with jwtToken " + accessToken);
            return null;
        }
    }
}
